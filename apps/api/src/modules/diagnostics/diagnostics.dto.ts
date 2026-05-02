import { IsOptional, IsString, MaxLength } from 'class-validator';

export class FaultLifecycleUpdateDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
