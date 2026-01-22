import { IsString, IsNotEmpty, IsNumber, IsOptional, IsEnum, Min } from 'class-validator';

export class TopUpDto {
    @IsNumber()
    @Min(1)
    amount: number;

    @IsString()
    @IsNotEmpty()
    paymentMethodId: string;
}

export class GenerateInvoiceDto {
    @IsString()
    @IsNotEmpty()
    userId: string;
}

export class CreatePaymentMethodDto {
    @IsString()
    @IsNotEmpty()
    type: string; // card, bank_transfer

    @IsString()
    @IsNotEmpty()
    token: string; // stripe token etc
}
