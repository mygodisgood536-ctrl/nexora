import type { PrincipalPayload } from "../middleware/auth";

declare global {
  namespace Express {
    interface Request {
      principal?: PrincipalPayload;
    }
  }
}

export {};
