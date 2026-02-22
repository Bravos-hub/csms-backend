import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'https://api.evzonecharging.com';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      stages: [
        { duration: '2m', target: Number(__ENV.BASELINE_VUS || 50) },
        { duration: '5m', target: Number(__ENV.SPIKE_VUS || 250) },
        { duration: '10m', target: Number(__ENV.BASELINE_VUS || 50) },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
  },
};

export default function () {
  const response = http.get(`${BASE_URL}/health/live`);
  check(response, {
    'status is 200': (r) => r.status === 200,
  });
  sleep(0.2);
}
