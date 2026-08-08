-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'CONTRACT';
ALTER TYPE "DocumentType" ADD VALUE 'INVOICE';
ALTER TYPE "DocumentType" ADD VALUE 'CERTIFICATE';
ALTER TYPE "DocumentType" ADD VALUE 'IDENTITY';
ALTER TYPE "DocumentType" ADD VALUE 'STATEMENT';
ALTER TYPE "DocumentType" ADD VALUE 'LETTER';
ALTER TYPE "DocumentType" ADD VALUE 'NOTICE';
ALTER TYPE "DocumentType" ADD VALUE 'RECEIPT';
