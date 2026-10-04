-- 0045_payment_provider_registry
-- Part 8 — the Dynamic Provider Registry (RULE 8.1.1 / 8.1.2 / 8.3.1).
-- The registry is data, not code: it ships pre-configured with Monnify,
-- Flutterwave, Paystack, Squad, OPay, PalmPay and a "generic or manual"
-- entry, and stores each provider's requirement set (fields + how-to-get +
-- validation), capability flags, connection descriptor, webhook descriptor
-- and virtual-account descriptor so the provider screen is generated from
-- this table rather than hard-coded.
--
-- It is platform-owned read-mostly data (like permission_verbs): every
-- company reads the same registry, so it is not company-scoped and carries
-- no tenant column. Writes are confined to the platform/owner path.

BEGIN;

CREATE TABLE IF NOT EXISTS payment_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  logo_url text,
  documentation_url text,
  supported_country text NOT NULL DEFAULT 'NG',
  supported_currency text NOT NULL DEFAULT 'NGN',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deprecated')),
  -- RULE 8.3.1 requirement set: ordered fields a company must supply.
  -- Each field: { key, label, description, how_to_get, secret, required,
  --              validation, example, customer_specific, company_specific }
  requirement_set jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Capability flags (virtual accounts / static / dynamic / bulk /
  -- account replacement / settlement reporting / reversal / KYC level)
  capability_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- How to authenticate and what a successful test looks like.
  connection_descriptor jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Which signature scheme, which header, which secret, IP allow-list,
  -- and how the payload identifies customer and account.
  webhook_descriptor jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Which per-customer fields the provider needs (KYC-sensitive ones flagged).
  virtual_account_descriptor jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_payment_providers_updated BEFORE UPDATE ON payment_providers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

GRANT SELECT ON payment_providers TO nexora;
REVOKE INSERT, UPDATE, DELETE ON payment_providers FROM nexora;

-- ============================================================
-- Seed — RULE 8.1.2: the registry must ship pre-configured with
-- Monnify, Flutterwave, Paystack, Squad, OPay, PalmPay plus a generic entry.
-- Guidance below is taken from each provider's published API documentation
-- (see Part 8 §8.1 research summary in vision-v39.txt).
-- ============================================================

INSERT INTO payment_providers (code, name, documentation_url, requirement_set, capability_flags, connection_descriptor, webhook_descriptor, virtual_account_descriptor) VALUES
('monnify', 'Monnify', 'https://docs.monnify.com',
 '[{"key":"api_key","label":"API key","description":"API key issued for your merchant account.","how_to_get":"Monnify dashboard: Settings, then API keys.","secret":true,"required":true,"validation":"^k_","example":"k_pk_abcdef0123456789","customer_specific":false,"company_specific":true},{"key":"secret_key","label":"Secret key","description":"Secret used to sign webhooks (HMAC-SHA512).","how_to_get":"Monnify dashboard: Settings, then API keys.","secret":true,"required":true,"validation":"length>=16","example":"SK_6c5c2a1e9f31d0c8","customer_specific":false,"company_specific":true},{"key":"contract_code","label":"Contract code","description":"The merchant contract for this collection product.","how_to_get":"Monnify dashboard: Settings, then Contract details.","secret":false,"required":true,"validation":"length>=6","example":"MKFF-0421","customer_specific":false,"company_specific":true},{"key":"settlement_reference","label":"Settlement / wallet reference","description":"The merchant settlement or wallet reference used for payouts.","how_to_get":"Monnify dashboard: Settlements, then wallet reference.","secret":false,"required":true,"validation":"length>=4","example":"MNFY-WAL-0421","customer_specific":false,"company_specific":true}]'::jsonb,
 '{"virtual_accounts":true,"static_accounts":true,"dynamic_accounts":true,"bulk_creation":true,"account_replacement":true,"settlement_reporting":true,"reversal":true,"kyc_level":"bvn_or_nin"}'::jsonb,
 '{"auth_type":"hmac","key_kind":"merchant_secret_key","test_endpoint":"https://sandbox.monnify.com/api/v1/auth/login","success_shape":{"requestSuccessful":true},"failure_shape":{"requestSuccessful":false}}'::jsonb,
 '{"scheme":"hmac_sha512","header":"monnify-signature","secret_ref":"secret_key","ip_allowlist":true,"events":["payment received","REVERSED","TRANSFER"],"customer_identity":"virtualAccount.accountNumber","account_identity":"accountNumber"}'::jsonb,
 '{"required_per_customer":["bvn","nin"],"kyc_sensitive":["bvn","nin"],"response_account_number":"accountNumber","response_bank_name":"bankName","response_reference":"reference"}'::jsonb),
('flutterwave', 'Flutterwave', 'https://developers.flutterwave.com',
 '[{"key":"public_key","label":"Public key","description":"Public key for your Flutterwave account.","how_to_get":"Flutterwave dashboard: Settings, then API. Prefix FLWPUBK.","secret":false,"required":true,"validation":"^FLWPUBK","example":"FLWPUBK-abc123","customer_specific":false,"company_specific":true},{"key":"secret_key","label":"Secret key","description":"Secret key for your Flutterwave account.","how_to_get":"Flutterwave dashboard: Settings, then API. Prefix FLWSECK.","secret":true,"required":true,"validation":"^FLWSECK","example":"FLWSECK-abcd1234","customer_specific":false,"company_specific":true},{"key":"secret_hash","label":"Secret hash","description":"Verification hash used to authenticate webhooks.","how_to_get":"Flutterwave dashboard: Settings, then Webhooks, set a secret hash.","secret":true,"required":true,"validation":"length>=8","example":"flw-secret-hash","customer_specific":false,"company_specific":true},{"key":"preferred_bank_code","label":"Preferred bank code","description":"Preferred bank for generated static virtual accounts.","how_to_get":"Flutterwave API banks list, or ask your account manager.","secret":false,"required":false,"validation":"length>=3","example":"044","customer_specific":false,"company_specific":true}]'::jsonb,
 '{"virtual_accounts":true,"static_accounts":true,"dynamic_accounts":true,"bulk_creation":false,"account_replacement":true,"settlement_reporting":true,"reversal":true,"kyc_level":"bvn_or_nin"}'::jsonb,
 '{"auth_type":"bearer","key_kind":"secret_key","test_endpoint":"https://api.flutterwave.com/v3/balances/NGN","success_shape":{"status":"success"},"failure_shape":{"status":"error"}}'::jsonb,
 '{"scheme":"verif_hash","header":"verif-hash","secret_ref":"secret_hash","ip_allowlist":false,"events":["charge.completed","charge.failed","transfer.completed"],"customer_identity":"data.account_number","account_identity":"account_number"}'::jsonb,
 '{"required_per_customer":["first_name","last_name","email","bvn","nin"],"kyc_sensitive":["bvn","nin"],"response_account_number":"data.account_number","response_bank_name":"data.bank_name","response_reference":"data.reference"}'::jsonb),
('paystack', 'Paystack', 'https://paystack.com/docs',
 '[{"key":"secret_key","label":"Secret key","description":"Secret key for your Paystack account.","how_to_get":"Paystack dashboard: Settings, then API Keys. Prefix sk_.","secret":true,"required":true,"validation":"^sk_","example":"sk_live_abcdef","customer_specific":false,"company_specific":true},{"key":"preferred_bank_provider","label":"Preferred bank provider","description":"Bank provider slug for dedicated virtual accounts.","how_to_get":"Paystack dashboard: Banks providers list, or the providers API.","secret":false,"required":false,"validation":"^[a-z0-9_]+$","example":"wema-bank","customer_specific":false,"company_specific":true}]'::jsonb,
 '{"virtual_accounts":true,"static_accounts":true,"dynamic_accounts":false,"bulk_creation":false,"account_replacement":true,"settlement_reporting":true,"reversal":true,"kyc_level":"customer_record"}'::jsonb,
 '{"auth_type":"bearer","key_kind":"secret_key","test_endpoint":"https://api.paystack.co/balance","success_shape":{"status":true},"failure_shape":{"status":false}}'::jsonb,
 '{"scheme":"hmac_sha512","header":"x-paystack-signature","secret_ref":"secret_key","ip_allowlist":true,"events":["charge.success","transfer.success"],"customer_identity":"data.customer.customer_code","account_identity":"data.details.account_number"}'::jsonb,
 '{"required_per_customer":["name","email"],"kyc_sensitive":[],"response_account_number":"data.details.account_number","response_bank_name":"data.details.bank_name","response_reference":"data.reference"}'::jsonb),
('squad', 'Squad (HabariPay, GTCO)', 'https://squadco.com/developers',
 '[{"key":"secret_key","label":"Secret key","description":"Secret key for the Squad merchant account.","how_to_get":"Squad dashboard: Settings, then API Keys.","secret":true,"required":true,"validation":"^SQ","example":"SQ_abcdef123456","customer_specific":false,"company_specific":true},{"key":"settlement_account","label":"Settlement (beneficiary) account","description":"Beneficiary account that receives settlements.","how_to_get":"Squad dashboard: Settlements, then beneficiary account.","secret":false,"required":true,"validation":"length>=10","example":"0123456789","customer_specific":false,"company_specific":true},{"key":"virtual_account_prefix","label":"Virtual account prefix","description":"Prefix used for generated virtual account numbers.","how_to_get":"Agreed with Squad before go-live; visible in developer settings.","secret":false,"required":true,"validation":"^[0-9]{3,6}$","example":"779","customer_specific":false,"company_specific":true}]'::jsonb,
 '{"virtual_accounts":true,"static_accounts":true,"dynamic_accounts":false,"bulk_creation":true,"account_replacement":true,"settlement_reporting":true,"reversal":true,"kyc_level":"bvn_compulsory"}'::jsonb,
 '{"auth_type":"bearer","key_kind":"secret_key","test_endpoint":"https://api.squadco.com/merchant/api/v1/transaction/verify/mock","success_shape":{"success":true},"failure_shape":{"success":false}}'::jsonb,
 '{"scheme":"versioned","header":"x-squad-signature","secret_ref":"secret_key","ip_allowlist":false,"events":["credit","debit"],"customer_identity":"data.customer","account_identity":"data.details.account_number"}'::jsonb,
 '{"required_per_customer":["first_name","last_name","middle_name","mobile_number","date_of_birth","email","gender","address","bvn","customer_identifier"],"kyc_sensitive":["bvn","date_of_birth"],"response_account_number":"data.details.account_number","response_bank_name":"data.details.bank_name","response_reference":"data.reference"}'::jsonb),
('opay', 'OPay', 'https://openapi.opayweb.com',
 '[{"key":"merchant_id","label":"Merchant id","description":"The merchant id for your OPay business account.","how_to_get":"OPay business dashboard: account/profile page.","secret":false,"required":true,"validation":"length>=4","example":"2566220336201","customer_specific":false,"company_specific":true},{"key":"api_key","label":"API key","description":"API key issued for server-to-server calls.","how_to_get":"OPay business dashboard: Settings, API keys.","secret":true,"required":true,"validation":"length>=16","example":"OPAYPK-abcdefgh","customer_specific":false,"company_specific":true},{"key":"secret_key","label":"Secret key / merchant keys","description":"Secret used for request signing and callback verification.","how_to_get":"OPay business dashboard: Settings, API keys.","secret":true,"required":true,"validation":"length>=16","example":"OPAYSK-abcdefgh","customer_specific":false,"company_specific":true},{"key":"callback_url","label":"Callback URL","description":"The platform-generated callback path for this provider.","how_to_get":"Generated by the system; confirm it in OPay settings.","secret":false,"required":true,"validation":"^https?://","example":"https://api.company.com/webhooks/opay","customer_specific":false,"company_specific":true}]'::jsonb,
 '{"virtual_accounts":true,"static_accounts":true,"dynamic_accounts":true,"bulk_creation":false,"account_replacement":true,"settlement_reporting":false,"reversal":true,"kyc_level":"provider_kyc"}'::jsonb,
 '{"auth_type":"signature","key_kind":"merchant_keys","test_endpoint":"https://openapi.opayweb.com/api/v3/transactions/query-protocol","success_shape":{"code":"00000"},"failure_shape":{"code":"NON_ZERO"}}'::jsonb,
 '{"scheme":"merchant_spec","header":"Authorization","secret_ref":"secret_key","ip_allowlist":false,"events":["transfer","receive"],"customer_identity":"data.receiver.accountNo","account_identity":"data.receiver.accountNo"}'::jsonb,
 '{"required_per_customer":[],"kyc_sensitive":[],"response_account_number":"data.accountNo","response_bank_name":"data.bankCode","response_reference":"data.reference"}'::jsonb),
('palmpay', 'PalmPay', 'https://developers.palmpay.com',
 '[{"key":"merchant_id","label":"Merchant id","description":"Merchant id assigned after business onboarding.","how_to_get":"PalmPay business dashboard after merchant onboarding.","secret":false,"required":true,"validation":"length>=4","example":"PALM-0042","customer_specific":false,"company_specific":true},{"key":"api_key","label":"API key","description":"API key for PalmPay server calls.","how_to_get":"PalmPay business dashboard: developer section.","secret":true,"required":true,"validation":"length>=16","example":"PPK-abcdef1234","customer_specific":false,"company_specific":true},{"key":"secret_key","label":"Secret key","description":"Secret key for PalmPay callbacks.","how_to_get":"PalmPay business dashboard: developer section.","secret":true,"required":true,"validation":"length>=16","example":"PPSK-abcdef1234","customer_specific":false,"company_specific":true}]'::jsonb,
 '{"virtual_accounts":true,"static_accounts":false,"dynamic_accounts":true,"bulk_creation":false,"account_replacement":false,"settlement_reporting":false,"reversal":true,"kyc_level":"provider_kyc"}'::jsonb,
 '{"auth_type":"signature","key_kind":"merchant_keys","test_endpoint":"https://openapi.palmpay.com/api/v1/test","success_shape":{"code":"0000"},"failure_shape":{"code":"NON_ZERO"}}'::jsonb,
 '{"scheme":"merchant_spec","header":"X-Notary","secret_ref":"secret_key","ip_allowlist":false,"events":["pay"],"customer_identity":"data.payee.accountNo","account_identity":"data.accountNo"}'::jsonb,
 '{"required_per_customer":[],"kyc_sensitive":[],"response_account_number":"data.accountNo","response_bank_name":"data.bankName","response_reference":"data.reference"}'::jsonb),
('generic', 'Generic or manual provider', NULL,
 '[{"key":"provider_label","label":"Provider label","description":"A name the company uses for this provider.","how_to_get":"Free text chosen by the company.","secret":false,"required":true,"validation":"length>=2","example":"My Bank Collect","customer_specific":false,"company_specific":true},{"key":"api_base_url","label":"API base URL","description":"Base URL for server calls and webhook verification.","how_to_get":"Provided by the provider or the bank.","secret":false,"required":false,"validation":"^https?://","example":"https://collect.mybank.example","customer_specific":false,"company_specific":true},{"key":"api_key","label":"API key","description":"API key supplied by the provider.","how_to_get":"Provided by the provider.","secret":true,"required":false,"validation":"length>=8","example":"GCK-abcdef","customer_specific":false,"company_specific":true},{"key":"webhook_secret","label":"Webhook secret","description":"Secret used to verify incoming webhooks.","how_to_get":"Provided by the provider.","secret":true,"required":false,"validation":"length>=8","example":"GWS-abcdef","customer_specific":false,"company_specific":true},{"key":"virtual_account_prefix","label":"Virtual account prefix","description":"Prefix used on generated virtual-account numbers.","how_to_get":"Agreed with the provider.","secret":false,"required":false,"validation":"^[0-9A-Za-z-]{0,6}$","example":"NGZ-1","customer_specific":false,"company_specific":true}]'::jsonb,
 '{"virtual_accounts":true,"static_accounts":true,"dynamic_accounts":true,"bulk_creation":false,"account_replacement":true,"settlement_reporting":false,"reversal":true,"kyc_level":"company_defined"}'::jsonb,
 '{"auth_type":"bearer_or_signature","key_kind":"company_defined","test_endpoint":null,"success_shape":"any 2xx","failure_shape":"any non-2xx"}'::jsonb,
 '{"scheme":"company_defined","header":"company_defined","secret_ref":"webhook_secret","ip_allowlist":false,"events":["payment"],"customer_identity":"virtualAccount.accountNumber","account_identity":"accountNumber"}'::jsonb,
 '{"required_per_customer":[],"kyc_sensitive":[],"response_account_number":"accountNumber","response_bank_name":"bankName","response_reference":"reference"}'::jsonb)
ON CONFLICT (code) DO NOTHING;

COMMIT;