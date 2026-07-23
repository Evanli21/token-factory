import { Prisma, prisma, type ApiKey, type Model, type User } from '@szrouter/database';
import { config } from '../config.js';

type Identity = { user: User; apiKey?: ApiKey; organizationId?: string };

function monthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function reserveBalance(identity: Identity, model: Model, requestId: string, amount: number) {
  return prisma.$transaction(async (tx) => {
    if (identity.organizationId) {
      const organization = await tx.organization.findUnique({
        where: { id: identity.organizationId },
        include: { wallet: true },
      });
      if (!organization?.wallet || organization.status !== 'ACTIVE') throw new Error('Organization wallet unavailable');
      const used = await tx.organizationUsage.aggregate({
        where: { organizationId: organization.id, month: monthStart() },
        _sum: { cost: true },
      });
      if (organization.monthlyQuota && Number(used._sum.cost || 0) + amount > Number(organization.monthlyQuota)) {
        throw new Error('Organization monthly quota exceeded');
      }
      if (Number(organization.wallet.balance) - Number(organization.wallet.frozen) < amount) throw new Error('Insufficient organization balance');
      await tx.organizationWallet.update({ where: { id: organization.wallet.id }, data: { frozen: { increment: amount } } });
    } else {
      const wallet = await tx.wallet.findUnique({ where: { userId: identity.user.id } });
      if (!wallet) throw new Error('Wallet unavailable');
      if (identity.user.monthlyQuota) {
        const used = await tx.usageLog.aggregate({
          where: { userId: identity.user.id, createdAt: { gte: monthStart() }, status: 'SUCCESS' },
          _sum: { cost: true },
        });
        if (Number(used._sum.cost || 0) + amount > Number(identity.user.monthlyQuota)) throw new Error('Monthly quota exceeded');
      }
      if (Number(wallet.balance) - Number(wallet.frozen) < amount) throw new Error('Insufficient balance');
      await tx.wallet.update({ where: { id: wallet.id }, data: { frozen: { increment: amount } } });
    }

    return tx.reservation.create({
      data: {
        userId: identity.user.id,
        apiKeyId: identity.apiKey?.id,
        organizationId: identity.organizationId,
        modelId: model.id,
        requestId,
        amount,
        expiresAt: new Date(Date.now() + config.RESERVATION_TTL_SECONDS * 1000),
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function settleBalance(requestId: string, actualCost: number, success = true) {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({ where: { requestId } });
    if (!reservation || reservation.status !== 'PENDING') return reservation;
    const cost = success ? actualCost : 0;
    const status = success ? 'SETTLED' : 'RELEASED';

    if (reservation.organizationId) {
      const wallet = await tx.organizationWallet.findUniqueOrThrow({ where: { organizationId: reservation.organizationId } });
      const updated = await tx.organizationWallet.update({
        where: { id: wallet.id },
        data: { frozen: { decrement: reservation.amount }, balance: { decrement: cost } },
      });
      if (cost > 0) {
        await tx.organizationTransaction.create({
          data: {
            organizationId: reservation.organizationId,
            organizationWalletId: wallet.id,
            type: 'USAGE', amount: -cost, balance: updated.balance, referenceId: requestId,
          },
        });
        await tx.organizationUsage.upsert({
          where: { organizationId_userId_month: { organizationId: reservation.organizationId, userId: reservation.userId, month: monthStart() } },
          create: { organizationId: reservation.organizationId, userId: reservation.userId, month: monthStart(), requestCount: 1, cost },
          update: { requestCount: { increment: 1 }, cost: { increment: cost } },
        });
      }
    } else {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: reservation.userId } });
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { frozen: { decrement: reservation.amount }, balance: { decrement: cost } },
      });
      if (cost > 0) {
        await tx.transaction.create({
          data: { walletId: wallet.id, type: 'USAGE', amount: -cost, balance: updated.balance, referenceId: requestId },
        });
      }
    }

    return tx.reservation.update({ where: { id: reservation.id }, data: { status, settledAt: new Date() } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
