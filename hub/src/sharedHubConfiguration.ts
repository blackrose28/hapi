export type SharedHubConfiguration = {
    organizationId: string
    organizationName: string
    oidcIssuer: string
    oidcClientId: string
    bootstrapAdminEmail: string
    authPepper: string
    callbackUrl: string
    appUrl: string
}

export function loadSharedHubConfiguration(env: NodeJS.ProcessEnv, publicUrl: string): SharedHubConfiguration {
    const appUrl = requireHttpsUrl(publicUrl, 'HAPI_PUBLIC_URL')
    const oidcIssuer = requireHttpsUrl(required(env, 'HAPI_OIDC_ISSUER'), 'HAPI_OIDC_ISSUER').replace(/\/$/, '')
    const authPepper = required(env, 'HAPI_AUTH_PEPPER')
    if (authPepper.length < 32) throw new Error('HAPI_AUTH_PEPPER must contain at least 32 characters.')
    const bootstrapAdminEmail = required(env, 'HAPI_BOOTSTRAP_ADMIN_EMAIL').trim().toLowerCase()
    if (!bootstrapAdminEmail.includes('@')) throw new Error('HAPI_BOOTSTRAP_ADMIN_EMAIL must be a valid email address.')
    return {
        organizationId: required(env, 'HAPI_ORGANIZATION_ID'),
        organizationName: required(env, 'HAPI_ORGANIZATION_NAME'),
        oidcIssuer,
        oidcClientId: required(env, 'HAPI_OIDC_CLIENT_ID'),
        bootstrapAdminEmail,
        authPepper,
        callbackUrl: new URL('/api/auth/callback', appUrl).toString(),
        appUrl
    }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name]?.trim()
    if (!value) throw new Error(`Missing required Shared Hub setting: ${name}.`)
    return value
}

function requireHttpsUrl(value: string, name: string): string {
    let url: URL
    try {
        url = new URL(value)
    } catch {
        throw new Error(`${name} must be an HTTPS URL.`)
    }
    if (url.protocol !== 'https:') throw new Error(`${name} must be an HTTPS URL.`)
    return url.toString()
}
