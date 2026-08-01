import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import { createInterface } from 'node:readline/promises'

function isInteractive(): boolean {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

async function ask(question: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
        return (await rl.question(question)).trim()
    } finally {
        rl.close()
    }
}

/**
 * Prompts until a non-empty (and, if `validate` is given, valid) value is entered.
 * Returns undefined immediately when stdin/stdout isn't a TTY, so callers can fall
 * back to their existing non-interactive error/usage message.
 */
export async function promptRequired(
    question: string,
    validate?: (value: string) => { ok: true; value: string } | { ok: false; error: string }
): Promise<string | undefined> {
    if (!isInteractive()) return undefined
    for (;;) {
        const answer = await ask(question)
        if (!answer) {
            console.log('A value is required.')
            continue
        }
        if (!validate) return answer
        const result = validate(answer)
        if (result.ok) return result.value
        console.log(result.error)
    }
}

/**
 * Lets the user pick one of `choices` by number, or type a new value.
 * Returns undefined immediately when stdin/stdout isn't a TTY.
 */
export async function promptChoiceOrNew(label: string, choices: string[]): Promise<string | undefined> {
    if (!isInteractive()) return undefined
    if (choices.length === 0) {
        return promptRequired(`${label}: `)
    }
    console.log(`${label}:`)
    choices.forEach((choice, i) => console.log(`  ${i + 1}) ${choice}`))
    console.log(`  ${choices.length + 1}) Enter a different name`)
    for (;;) {
        const answer = await ask(`Select 1-${choices.length + 1}: `)
        const index = Number(answer)
        if (Number.isInteger(index) && index >= 1 && index <= choices.length) return choices[index - 1]
        if (index === choices.length + 1) return promptRequired('Profile name: ')
        console.log('Invalid selection.')
    }
}
