import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ServiceLog {
  timestamp: string;
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  context?: string;
}

export interface ServiceEvent {
  id: string;
  time: string;
  severity: 'error' | 'warning' | 'info' | 'resolved';
  message: string;
  service?: string;
}

@Injectable()
export class ServiceManagerService {
  private readonly logger = new Logger(ServiceManagerService.name);
  private readonly events: ServiceEvent[] = [];
  private readonly dockerComposeCandidates: ReadonlyArray<
    Readonly<{ command: string; preArgs: string[] }>
  > = [
    { command: 'docker', preArgs: ['compose'] },
    { command: 'docker-compose', preArgs: [] },
  ];

  async restartService(
    serviceName: string,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Restart requested for service: ${serviceName}`);
    const dockerServiceName = this.mapServiceToDockerName(serviceName);

    if (!dockerServiceName) {
      throw new BadRequestException(
        `Service ${serviceName} cannot be restarted from the API`,
      );
    }

    this.addEvent({
      severity: 'info',
      message: `Restart initiated for ${serviceName}`,
      service: serviceName,
    });

    try {
      const result = await this.runDockerCompose(
        ['restart', dockerServiceName],
        30_000,
      );

      this.logger.log(
        `Restarted ${serviceName} using "${result.executedCommand}"`,
      );
      this.addEvent({
        severity: 'resolved',
        message: `${serviceName} restarted successfully`,
        service: serviceName,
      });

      return {
        success: true,
        message: `Service ${serviceName} restarted successfully`,
      };
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.error(`Failed to restart ${serviceName}: ${message}`);

      this.addEvent({
        severity: 'error',
        message: `Failed to restart ${serviceName}: ${message}`,
        service: serviceName,
      });

      return {
        success: false,
        message: `Failed to restart ${serviceName}: ${message}`,
      };
    }
  }

  async getServiceLogs(
    serviceName: string,
    lines: number = 100,
  ): Promise<ServiceLog[]> {
    this.logger.log(`Fetching logs for service: ${serviceName}`);
    const dockerServiceName = this.mapServiceToDockerName(serviceName);

    if (!dockerServiceName) {
      throw new BadRequestException(
        `Service ${serviceName} does not expose container logs`,
      );
    }

    const normalizedLines = Math.min(
      Math.max(Math.floor(lines || 100), 1),
      500,
    );
    const result = await this.runDockerCompose(
      ['logs', `--tail=${normalizedLines}`, dockerServiceName],
      10_000,
    );
    return this.parseLogs(result.stdout || result.stderr);
  }

  getSystemEvents(limit: number = 50): ServiceEvent[] {
    const normalizedLimit = Math.min(Math.max(Math.floor(limit || 50), 1), 500);
    return this.events.slice(-normalizedLimit).reverse();
  }

  private addEvent(event: Omit<ServiceEvent, 'id' | 'time'>): void {
    const newEvent: ServiceEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      time: new Date().toISOString(),
      ...event,
    };

    this.events.push(newEvent);
    if (this.events.length > 1000) {
      this.events.shift();
    }
  }

  private mapServiceToDockerName(serviceName: string): string | null {
    const mapping: Record<string, string | null> = {
      Database: 'postgres',
      'Redis Cache': 'redis',
      'OCPP Gateway': 'ocpp-gateway',
      'Payment Gateway': null,
    };

    return mapping[serviceName] || null;
  }

  private async runDockerCompose(
    args: string[],
    timeout: number,
  ): Promise<{
    stdout: string;
    stderr: string;
    executedCommand: string;
  }> {
    const failures: string[] = [];

    for (const candidate of this.dockerComposeCandidates) {
      const commandArgs = [...candidate.preArgs, ...args];
      try {
        const { stdout, stderr } = await execFileAsync(
          candidate.command,
          commandArgs,
          {
            timeout,
            maxBuffer: 10 * 1024 * 1024,
          },
        );

        return {
          stdout: stdout || '',
          stderr: stderr || '',
          executedCommand: `${candidate.command} ${commandArgs.join(' ')}`,
        };
      } catch (error) {
        failures.push(
          `${candidate.command}: ${this.errorMessage(error).replace(/[\r\n]+/g, ' ')}`,
        );
      }
    }

    throw new Error(
      `Unable to execute Docker Compose command (${args.join(' ')}): ${failures.join(' | ')}`,
    );
  }

  private parseLogs(logOutput: string): ServiceLog[] {
    const lines = logOutput
      .split('\n')
      .filter((line) => line.trim().length > 0);
    const logs: ServiceLog[] = [];

    for (const line of lines) {
      const timestampMatch = line.match(
        /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)/,
      );
      const levelMatch = line.match(/\b(error|warn|warning|info|debug)\b/i);

      logs.push({
        timestamp: timestampMatch?.[1] || new Date().toISOString(),
        level: this.normalizeLogLevel(levelMatch?.[1]),
        message: line,
      });
    }

    return logs;
  }

  private normalizeLogLevel(level: unknown): ServiceLog['level'] {
    const normalized = typeof level === 'string' ? level.toLowerCase() : '';
    if (normalized === 'error') return 'error';
    if (normalized === 'warn' || normalized === 'warning') return 'warn';
    if (normalized === 'debug') return 'debug';
    return 'info';
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
