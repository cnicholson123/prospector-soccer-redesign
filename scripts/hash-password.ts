import { hashPassword } from '../server/auth/password';

// TTY input is raw so the terminal never echoes the password. Piped input is
// read directly from stdin, never from argv, the environment or a log message.
async function readPassword(): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) {
    let value = '';
    for await (const chunk of input) {
      value += chunk.toString();
      if (value.length > 1026) throw new Error('Password too long');
    }
    return value.replace(/\r?\n$/, '');
  }
  process.stderr.write('Password (hidden): ');
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.setEncoding('utf8');
  input.resume();
  try {
    return await new Promise<string>((resolve, reject) => {
      let value = '';
      const done = (error?: Error) => {
        input.off('data', onData);
        error ? reject(error) : resolve(value);
      };
      const onData = (chunk: string) => {
        for (const character of chunk) {
          if (character === '\u0003' || character === '\u0004') { done(new Error('Cancelled')); return; }
          if (character === '\r' || character === '\n') { done(); return; }
          if (character === '\u007f' || character === '\b') value = [...value].slice(0, -1).join('');
          else value += character;
          if (value.length > 1024) { done(new Error('Password too long')); return; }
        }
      };
      input.on('data', onData);
    });
  } finally {
    input.setRawMode(wasRaw);
    input.pause();
    process.stderr.write('\n');
  }
}
try {
  const password = await readPassword();
  if (!password.length || password.length > 1024 || /[\r\n]/.test(password)) throw new Error('Invalid input');
  process.stdout.write(`${await hashPassword(password)}\n`);
} catch {
  process.stderr.write('Password hashing cancelled or invalid input.\n');
  process.exitCode = 1;
}
