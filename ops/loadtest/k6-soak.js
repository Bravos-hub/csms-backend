import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://api.evzonecharging.com';

export const options = {
  vus: Number(__ENV.VUS || 80),
  duration: __ENV.DURATION || '12h',
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<800', 'p(99)<1500'],
  },
};

export default function () {
  const response = http.get(`${BASE_URL}/health/ready`);
  check(response, {
    'status is 200': (r) => r.status === 200,
  });
  sleep(1);
}
