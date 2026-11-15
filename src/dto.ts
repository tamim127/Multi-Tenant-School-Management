import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
export class LoginDto {
  @ApiProperty({ type: String, example: 'owner.alpha@example.test' })
  @IsEmail()
  @Length(3, 254)
  email!: string;
  @ApiProperty({ type: String, minLength: 12, maxLength: 128 })
  @IsString()
  @Length(12, 128)
  password!: string;
}
export class RegisterDto extends LoginDto {
  @ApiProperty({ type: String }) @IsString() @Length(1, 120) displayName!: string;
}
export class ProfileDto {
  @ApiProperty({ type: String }) @IsString() @Length(1, 120) displayName!: string;
}
export class TenantDto {
  @ApiProperty({ type: String }) @IsString() @Length(1, 120) name!: string;
  @ApiProperty({ type: String, example: 'example-school' })
  @Matches(/^[a-z0-9][a-z0-9-]{2,62}$/)
  slug!: string;
  @ApiProperty({ type: String, enum: ['school@1'] }) @IsIn(['school@1']) preset!: string;
}
export class CampusDto {
  @ApiProperty({ type: String }) @IsString() @Length(1, 120) name!: string;
  @ApiProperty({ type: String }) @Matches(/^[A-Z0-9_-]{1,24}$/) code!: string;
}
export class MembershipDto {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID() userId!: string;
  @ApiProperty({ type: String, enum: ['admin', 'staff', 'viewer'] })
  @IsIn(['admin', 'staff', 'viewer'])
  role!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  campusId?: string | null;
}
export class RoleDto {
  @ApiProperty({ type: String, enum: ['admin', 'staff', 'viewer'] })
  @IsIn(['admin', 'staff', 'viewer'])
  role!: string;
}
