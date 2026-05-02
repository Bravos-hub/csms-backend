import * as fs from 'fs';
import * as path from 'path';

async function run() {
  console.log('--- Standalone SendGrid Diagnostic ---');

  // Manually parse .env since we don't want NestJS overhead/errors
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.error('ERROR: .env file not found in current directory:', envPath);
    return;
  }

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

  console.log(`API Key: ${apiKey ? 'Found (starts with ' + apiKey.slice(0, 7) + '...)' : 'MISSING'}`);
  console.log(`From Email: ${fromEmail}`);

  if (!apiKey) {
    console.error('ERROR: TWILIO_SENDGRID_API_KEY not found in .env');
    return;
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // 1. Check API Key validity
  console.log('\n[1/3] Checking API Key via /api_keys...');
  try {
    const res = await fetch('https://api.sendgrid.com/v3/api_keys', { headers });
    console.log(`Status: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (res.ok) {
      console.log('SUCCESS: API Key is valid.');
    } else {
      console.error('FAILURE:', JSON.stringify(data));
    }
  } catch (e) {
    console.error('ERROR:', e);
  }

  // 2. Check Credits
  console.log('\n[2/3] Checking Credits via /user/credits...');
  try {
    const res = await fetch('https://api.sendgrid.com/v3/user/credits', { headers });
    console.log(`Status: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (res.ok) {
      console.log('SUCCESS: Credit Info:', JSON.stringify(data, null, 2));
    } else {
      console.error('FAILURE:', JSON.stringify(data));
    }
  } catch (e) {
    console.error('ERROR:', e);
  }

  // 3. Check Sender Verification
  console.log('\n[3/3] Checking Senders via /senders...');
  try {
    const res = await fetch('https://api.sendgrid.com/v3/senders', { headers });
    console.log(`Status: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (res.ok) {
       console.log('SUCCESS: Retrieved senders list.');
       // Check if any sender matches the from email
       const senders = Array.isArray(data) ? data : (data.results || []);
       const match = senders.find((s: any) => (s.from?.email === fromEmail) || (s.email === fromEmail));
       if (match) {
         console.log(`MATCH FOUND: Sender ${fromEmail} exists. Verified: ${match.verified?.status || 'unknown'}`);
       } else {
         console.log(`NO MATCH: ${fromEmail} not found in senders list.`);
       }
    } else {
      console.error('FAILURE:', JSON.stringify(data));
    }
  } catch (e) {
    console.error('ERROR:', e);
  }
}

run();
