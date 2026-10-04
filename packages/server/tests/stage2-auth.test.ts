import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { SEED_PASSWORD, seedWorld, withAdmin } from "./fixtures";
import { totpNow } from "../src/lib/totp";

const HOST = "alpha-test.localhost";

function login(app: Express, username: string, password: string, host = HOST) {
  return request(app)
    .post("/api/v1/auth/login")
    .set("Host", host)
    .send({ username, password });
}

describe("stage 2 authentication & session lifecycle", () => {
  it("resolves the company from the portal host BEFORE checking credentials", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();

    // Unknown user on a valid host -> uniform invalid-credentials error.
    const ghost = await login(app, "nobody", "whatever");
    expect(ghost.status).toBe(401);

    // Valid user on an UNKNOWN host -> host resolution fails first.
    const badHost = await request(app)
      .post("/api/v1/auth/login")
      .set("Host", "nosuch.localhost")
      .send({ username: "alice", password: SEED_PASSWORD });
    expect(badHost.status).toBe(401);
    expect(badHost.body.error.code).toBe("UNAUTHORIZED");

    // Branch-prefixed host also resolves to the same company.
    const branchHost = await login(app, "alice", SEED_PASSWORD, "alpha-test-abj.localhost");
    expect(branchHost.status).toBe(200);
    expect(branchHost.body.principal.companyId).toBeTruthy();
    expect(branchHost.body.mustChangePassword).toBe(false);
  });

  it("rejects wrong passwords with the same uniform error", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const res = await login(app, "alice", "wrong-password");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("merges permissions from multiple active assignments into the session", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();

    const alice = await login(app, "alice", SEED_PASSWORD);
    expect(alice.status).toBe(200);
    const perms: string[] = alice.body.principal.permissions;
    for (const verb of ["view", "create", "export", "approve", "assign", "suspend", "edit"]) {
      expect(perms).toContain(verb);
    }
    expect(perms).not.toContain("disburse");
    expect(alice.body.principal.roles).toHaveLength(2);

    const bob = await login(app, "bob", SEED_PASSWORD, "beta-test.localhost");
    expect(bob.status).toBe(200);
    expect(bob.body.principal.permissions).toContain("configure");
  });

  it("rejects logins for an expired initial credential with CREDENTIAL_EXPIRED", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const res = await login(app, "tempuser", SEED_PASSWORD);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CREDENTIAL_EXPIRED");
  });

  it("runs the full credential ritual and only then releases the session", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();

    // tempuser is credential_issued with a *past* window; extend it so the
    // ritual can be exercised (the expired path is covered above). The
    // previous test flips the state to credential_expired, so restore it.
    await withAdmin(async (admin) => {
      await admin.query(
        `UPDATE users
            SET credential_state='credential_issued',
                temp_password_expires_at = now() + interval '1 hour',
                credential_expires_at = now() + interval '1 day'
          WHERE username='tempuser'`
      );
    });

    const first = await login(app, "tempuser", SEED_PASSWORD);
    expect(first.status).toBe(200);
    expect(first.body.mustChangePassword).toBe(true);
    expect(first.body.credentialState).toBe("credential_issued");
    const token = first.body.accessToken as string;

    // The ritual token reaching a normal resource is refused and told why.
    const gated = await request(app)
      .get("/api/v1/auth/session-check")
      .set("Authorization", `Bearer ${token}`);
    expect(gated.status).toBe(403);
    expect(gated.body.error.code).toBe("CREDENTIAL_RITUAL_REQUIRED");
    expect(gated.body.error.message).toContain("change-password");

    const status = await request(app)
      .get("/api/v1/auth/ritual/status")
      .set("Authorization", `Bearer ${token}`);
    expect(status.status).toBe(200);
    expect(status.body.credentialState).toBe("credential_issued");
    expect(status.body.nextStep).toBe("change_password");

    // Step 2 — enrol the authenticator (resumable secret).
    const enrol = await request(app)
      .post("/api/v1/auth/ritual/enrollment")
      .set("Authorization", `Bearer ${token}`);
    expect(enrol.status).toBe(200);
    const secret = enrol.body.secret as string;
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    const otpauth = enrol.body.otpauthUri as string;
    expect(otpauth).toContain("otpauth://totp/Nexora:");

    // Step 3 — verify with a live code.
    const verify = await request(app)
      .post("/api/v1/auth/ritual/verify-authenticator")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: totpNow(secret) });
    expect(verify.status).toBe(204);

    // Step 1 (completed last, per RULE 4.2.1 interleaving) — change the
    // password; the change itself is verified with a live authenticator code.
    const change = await request(app)
      .post("/api/v1/auth/ritual/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({
        currentPassword: SEED_PASSWORD,
        newPassword: "NewPassword!456",
        // RULE 5.3.1.1 - the password is confirmed twice.
        confirmPassword: "NewPassword!456",
        totpCode: totpNow(secret)
      });
    expect(change.status).toBe(204);

    // A mismatched confirmation is refused rather than silently accepted.
    const mismatched = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({
        currentPassword: "NewPassword!456",
        newPassword: "AnotherPassword!789",
        confirmPassword: "DifferentPassword!789",
        totpCode: totpNow(secret)
      });
    expect(mismatched.status).toBe(422);

    // Step 4 — complete the profile; the account becomes secured right here.
    const complete = await request(app)
      .post("/api/v1/auth/ritual/complete-profile")
      .set("Authorization", `Bearer ${token}`)
      .send({
        passportPhotoUrl: "https://cdn.nexora.app/passports/tempuser.jpg",
        passportFileHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      });
    expect(complete.status).toBe(200);
    expect(complete.body.credentialState).toBe("secured");
    expect(complete.body.mustChangePassword).toBe(false);
    const securedToken = complete.body.accessToken as string;

    // Old credential is destroyed (RULE 5.2.3.3); new password signs in.
    const oldLogin = await login(app, "tempuser", SEED_PASSWORD);
    expect(oldLogin.status).toBe(401);
    const newLogin = await login(app, "tempuser", "NewPassword!456");
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.credentialState).toBe("secured");
    expect(newLogin.body.mustChangePassword).toBe(false);

    const released = await request(app)
      .get("/api/v1/auth/session-check")
      .set("Authorization", `Bearer ${securedToken}`);
    expect(released.status).toBe(200);
  });

  it("locks the account after the failed-attempt threshold and answers 423", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();

    // Five wrong attempts trip the threshold (default lockout_threshold=5).
    for (let i = 0; i < 5; i++) {
      const bad = await login(app, "alice", "wrong-password");
      expect(bad.status).toBe(401);
    }

    const locked = await login(app, "alice", SEED_PASSWORD);
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe("ACCOUNT_LOCKED");

    // Restore alice so later tests in this file share the cached world
    // without carrying the lockout forward.
    await withAdmin(async (admin) => {
      await admin.query(
        `UPDATE users SET failed_login_attempts=0, locked_until=NULL, updated_at=now()
          WHERE username='alice'`
      );
    });
  });

  it("rotates refresh tokens and rejects replayed cookies", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();

    const first = await login(app, "alice", SEED_PASSWORD);
    expect(first.status).toBe(200);
    const cookie = first.headers["set-cookie"] as unknown as string[];
    expect(cookie.some((c) => c.startsWith("nx_refresh="))).toBe(true);

    const refreshed = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookie)
      .set("Host", HOST);
    expect(refreshed.status).toBe(200);
    const newCookie = refreshed.headers["set-cookie"] as unknown as string[];
    expect(newCookie.some((c) => c.startsWith("nx_refresh="))).toBe(true);

    const replay = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookie)
      .set("Host", HOST);
    expect(replay.status).toBe(401);
  });

  it("logout revokes the presented refresh token", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();

    const first = await login(app, "alice", SEED_PASSWORD);
    const cookie = first.headers["set-cookie"] as unknown as string[];

    const out = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookie)
      .set("Host", HOST);
    expect(out.status).toBe(204);

    const after = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", cookie)
      .set("Host", HOST);
    expect(after.status).toBe(401);
  });

  it("reflects live permission changes on /auth/me without re-login", async () => {
    const app = (await import("../src/app")).createApp();
    const w = await seedWorld();

    const session = await login(app, "alice", SEED_PASSWORD);
    expect(session.status).toBe(200);
    const accessToken = session.body.accessToken as string;

    const before = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Host", HOST);
    expect(before.status).toBe(200);
    expect(before.body.permissions).toContain("approve");

    // End alice's temporary branch_manager assignment directly.
    await withAdmin(async (admin) => {
      await admin.query(
        `UPDATE role_assignments ra SET status='ended', ended_at=now()
           FROM roles r
          WHERE r.id=ra.role_id AND r.role_key='branch_manager'
            AND ra.user_id=$1`,
        [w.userA]
      );
    });

    const after = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Host", HOST);
    expect(after.status).toBe(200);
    expect(after.body.permissions).not.toContain("approve");
    expect(after.body.permissions).toContain("view");
  });
});
