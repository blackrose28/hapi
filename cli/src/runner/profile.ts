import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { constants, existsSync, readdirSync } from 'node:fs'
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { RunnerProfileNameSchema, RunnerProfileSchema, StoredRunnerCredentialSchema, type RunnerProfile, type StoredRunnerCredential } from '@hapi/protocol/runner-enrollment'

export type RunnerProfilePaths = { root:string; profileFile:string; credentialFile:string; stateFile:string; lockFile:string; logsDir:string }

export function resolveRunnerProfilePaths(home:string,name:string):RunnerProfilePaths {
    const profile=RunnerProfileNameSchema.parse(name),base=resolve(home,'profiles'),root=resolve(base,profile)
    if(!root.startsWith(base+sep))throw new Error('invalid_profile')
    return{root,profileFile:join(root,'profile.json'),credentialFile:join(root,'credential.json'),stateFile:join(root,'runner.state.json'),lockFile:join(root,'locks','runner.lock'),logsDir:join(root,'logs')}
}

/** Names of profiles enrolled under `home/profiles` (have a profile.json), sorted alphabetically. */
export function listEnrolledProfiles(home:string):string[] {
    const base=resolve(home,'profiles')
    if(!existsSync(base))return[]
    return readdirSync(base,{withFileTypes:true})
        .filter((entry)=>entry.isDirectory()&&existsSync(join(base,entry.name,'profile.json')))
        .map((entry)=>entry.name)
        .sort()
}

async function assertNoSymlink(path:string):Promise<void>{try{if((await lstat(path)).isSymbolicLink())throw new Error('unsafe_profile')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}
async function secureDirectories(paths:RunnerProfilePaths){await assertNoSymlink(dirname(paths.root));await assertNoSymlink(paths.root);await mkdir(join(paths.root,'locks'),{recursive:true,mode:0o700});await mkdir(paths.logsDir,{recursive:true,mode:0o700});await Promise.all([paths.root,join(paths.root,'locks'),paths.logsDir].map((p)=>import('node:fs/promises').then(({chmod})=>chmod(p,0o700))))}

async function atomicWrite(path:string,value:unknown){await assertNoSymlink(path);const tmp=`${path}.${process.pid}.${crypto.randomUUID()}.tmp`;const handle=await open(tmp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);try{await handle.writeFile(JSON.stringify(value,null,2));await handle.sync()}finally{await handle.close()}await rename(tmp,path);const dir=await open(dirname(path),constants.O_RDONLY);try{await dir.sync()}finally{await dir.close()}}

export async function createRunnerProfile(home:string,profile:RunnerProfile,credential:StoredRunnerCredential):Promise<RunnerProfilePaths>{const paths=resolveRunnerProfilePaths(home,profile.profile);try{await lstat(paths.root);throw new Error('profile_exists')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}await secureDirectories(paths);try{await atomicWrite(paths.profileFile,RunnerProfileSchema.parse(profile));await atomicWrite(paths.credentialFile,StoredRunnerCredentialSchema.parse(credential));return paths}catch(error){await rm(paths.root,{recursive:true,force:true});throw error}}
export async function readRunnerProfile(home:string,name:string):Promise<{profile:RunnerProfile;credential:StoredRunnerCredential;paths:RunnerProfilePaths}>{const paths=resolveRunnerProfilePaths(home,name);await assertNoSymlink(paths.root);for(const file of[paths.profileFile,paths.credentialFile])await assertNoSymlink(file);const rootReal=await realpath(paths.root);if(rootReal!==paths.root)throw new Error('unsafe_profile');try{return{profile:RunnerProfileSchema.parse(JSON.parse(await readFile(paths.profileFile,'utf8'))),credential:StoredRunnerCredentialSchema.parse(JSON.parse(await readFile(paths.credentialFile,'utf8'))),paths}}catch{throw new Error('corrupt_profile')}}
function processIsAlive(pid: number): boolean {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false
    try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}

export async function acquireRunnerProfileLock(paths: RunnerProfilePaths) {
    await secureDirectories(paths)
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const handle = await open(paths.lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
            await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() }))
            await handle.sync()
            return async () => { await handle.close(); await rm(paths.lockFile, { force: true }) }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            let ownerPid = 0
            try { ownerPid = Number(JSON.parse(await readFile(paths.lockFile, 'utf8')).pid) } catch { /* corrupt lock is stale */ }
            if (processIsAlive(ownerPid)) throw new Error('profile_locked')
            await rm(paths.lockFile, { force: true })
        }
    }
    throw new Error('profile_locked')
}
export async function writeRunnerProfileState(paths:RunnerProfilePaths,state:unknown){await atomicWrite(paths.stateFile,state)}
export async function readRunnerProfileState<T>(paths:RunnerProfilePaths):Promise<T|null>{try{await assertNoSymlink(paths.stateFile);return JSON.parse(await readFile(paths.stateFile,'utf8')) as T}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw new Error('corrupt_profile_state')}}
