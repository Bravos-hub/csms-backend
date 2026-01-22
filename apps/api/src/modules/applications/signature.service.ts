import { Injectable } from '@nestjs/common';

@Injectable()
export class SignatureService {
    async sendForSignature(applicationId: string, email: string, name: string, documentUrl: string) {
        console.log(`[Mock SignatureService] Sending document ${documentUrl} to ${name} <${email}> for application ${applicationId}`);
        return { envelopeId: 'mock-envelope-id', status: 'sent' };
    }
}
