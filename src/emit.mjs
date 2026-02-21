import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { request as httpRequest } from 'node:http';

export async function emitJson(url, jsonFilePath) {
  const data = readFileSync(jsonFilePath, 'utf8');
  const parsed = new URL(url);
  const reqFn = parsed.protocol === 'https:' ? request : httpRequest;

  return new Promise((resolve, reject) => {
    const req = reqFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString()
        });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
