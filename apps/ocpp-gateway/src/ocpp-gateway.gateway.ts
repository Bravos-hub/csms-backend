import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws'; // Import from 'ws' package for types
import { IncomingMessage } from 'http';
import { OcppGatewayService } from './ocpp-gateway.service'; // Assuming this service exists in the same directory

@WebSocketGateway({
    path: '/ocpp', // This handles /ocpp/CP_ID route usually, logic below
    transports: ['websocket'],
})
export class OcppGateway implements OnGatewayConnection, OnGatewayDisconnect {
    constructor(private readonly service: OcppGatewayService) { }

    @WebSocketServer()
    server: Server;

    handleConnection(client: WebSocket, request: IncomingMessage) {
        // OCPP Charger connects to /ocpp/{chargePointId}
        const url = request.url; // e.g., /ocpp/CP123
        const chargePointId = url?.split('/').pop();

        // Check subprotocol (ocpp1.6, ocpp2.0.1)
        const protocol = request.headers['sec-websocket-protocol'];

        console.log(`Client connected: ${chargePointId}, Protocol: ${protocol}`);

        // TODO: Validate charger against Auth/Station service

        // In a real app, strict protocol checks:
        // if (!protocol || (!protocol.includes('ocpp1.6') && !protocol.includes('ocpp2.0.1'))) {
        // Ideally close connection if protocol not supported, but NestJS WS adapter makes this tricky in handleConnection
        // client.close(1002, 'Protocol Error');
        // }
    }

    handleDisconnect(client: WebSocket) {
        console.log('Client disconnected');
    }

    @SubscribeMessage('message')
    handleMessage(client: WebSocket, payload: any): void {
        // OCPP Messages are array [MessageTypeId, UniqueId, Action, Payload]
        // For testing, we might get string or object depending on adapter
        console.log('Received message:', payload);

        // Mock extracting ID
        const chargePointId = 'CP_TEST'; // Should match connection context
        this.service.handleMessage(chargePointId, payload);
    }
}
