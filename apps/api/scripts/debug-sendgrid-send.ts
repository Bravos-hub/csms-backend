import * as fs from 'fs';
import * as path from 'path';

async function run() {
  console.log('--- SendGrid SEND TEST ---');

  const envPath = path.join(process.cwd(), '.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const env: Record<string, string> = {};
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim().replace(/^"|^'|"$|'$/g, '');
    }
  });

  const apiKey = env['TWILIO_SENDGRID_API_KEY'];
  const fromEmail = env['TWILIO_SENDGRID_FROM'];

  const payload = {
    personalizations: [{ to: [{ email: 'test@evzonecharging.com' }] }],
    from: { email: fromEmail },
    subject: 'SendGrid Diagnostic Test',
    content: [{ type: 'text/plain', value: 'This is a test to verify the "Maximum credits exceeded" error.' }]
  };

  console.log(`Sending from: ${fromEmail}`);
  console.log(`Using Key: ${apiKey.slice(0, 10)}...`);

  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    console.log(`Status: ${res.status} ${res.statusText}`);
    const body = await res.text();
    console.log(`Response Body: ${body}`);

    if (res.status === 401 && body.includes('Maximum credits exceeded')) {
      console.log('\nCONFIRMED: The account is indeed returning "Maximum credits exceeded" despite being a paid account.');
    }
  } catch (e) {
    console.error('ERROR:', e);
  }
}

run();
