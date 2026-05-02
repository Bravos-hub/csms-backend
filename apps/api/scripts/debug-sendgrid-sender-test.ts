import * as fs from 'fs';
import * as path from 'path';

async function run() {
  console.log('--- SendGrid TEST WITH RANDOM SENDER ---');

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

  const payload = {
    personalizations: [{ to: [{ email: 'test@evzonecharging.com' }] }],
    from: { email: 'random-unverified@example.com' }, // Random unverified email
    subject: 'SendGrid Random Sender Test',
    content: [{ type: 'text/plain', value: 'Testing if error changes with unverified sender.' }]
  };

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
  } catch (e) {
    console.error('ERROR:', e);
  }
}

run();
