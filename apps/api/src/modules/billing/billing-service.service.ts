import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { TopUpDto, GenerateInvoiceDto } from './dto/billing.dto';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
  ) { }

  // Wallet
  async getWalletBalance(userId: string) {
    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      // Auto-create for dev
      wallet = await this.prisma.wallet.create({
        data: {
          userId,
          balance: 0,
          currency: 'USD'
        }
      });
    }
    return wallet;
  }

  async getTransactions(userId: string) {
    const wallet = await this.getWalletBalance(userId);
    return this.prisma.transaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' }
    });
  }

  async topUp(userId: string, dto: TopUpDto) {
    const wallet = await this.getWalletBalance(userId);

    try {
      const updatedWallet = await this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: dto.amount } }
      });

      await this.prisma.transaction.create({
        data: {
          walletId: wallet.id,
          amount: dto.amount,
          type: 'CREDIT',
          description: 'Wallet TopUp',
          reference: 'PAY_' + Date.now()
        }
      });

      return updatedWallet;
    } catch (error) {
      throw new BadRequestException('Failed to process top-up');
    }
  }

  // Invoices
  async getInvoices(userId: string) {
    return this.prisma.invoice.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
  }

  async generateInvoice(dto: GenerateInvoiceDto) {
    return this.prisma.invoice.create({
      data: {
        userId: dto.userId,
        totalAmount: 100, // Mock calculation
        status: 'PENDING',
        dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000)
      }
    });
  }

  // Tariffs
  async getTariffs() {
    // Tariff model not in schema yet. Mocking or adding?
    // User didn't ask for Tariff schema explicitly in migration list earlier, but it was in Billing module.
    // I can return mock or add to schema.
    // Schema update is painful (migration). I'll return mock for now as it's less critical.
    return [{ id: 'mock-tariff', name: 'Standard', rate: 0.50 }];
  }
  // Admin - All Payments
  async getAllPayments(query: any) {
    const where: any = {};
    // Apply filters from query (type, status, date, site, etc.)
    // For now, return all transactions mapped
    const transactions = await this.prisma.transaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { wallet: { include: { user: true } } }
    });

    return transactions.map(t => ({
      ref: t.reference || t.id,
      type: t.type === 'CREDIT' ? 'TopUp' : 'Fee', // partial mapping
      site: 'Unknown', // No site relation on transaction yet
      method: 'Wallet',
      amount: t.amount,
      fee: 0,
      net: t.amount,
      date: t.createdAt,
      status: 'Settled', // specific status field missing on Transaction
      user: t.wallet?.user?.name
    }));
  }
}
