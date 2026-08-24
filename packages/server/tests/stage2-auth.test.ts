import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { SEED_PASSWORD, seedWorld, withAdmin } from "./fixtures";

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

  it("rejects logins for expired temporary passwords with a distinct code", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();
    const res = await login(app, "tempuser", SEED_PASSWORD);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("TEMP_PASSWORD_EXPIRED");
  });

  it("gates the session behind first-password change, then releases it", async () => {
    const app = (await import("../src/app")).createApp();
    await seedWorld();

    await withAdmin(async (admin) => {
      await admin.query(
        `UPDATE users SET temp_password_expires_at = now() + interval '1 hour'
          WHERE username='tempuser'`
      );
    });

    const first = await login(app, "tempuser", SEED_PASSWORD);
    expect(first.status).toBe(200);
    expect(first.body.mustChangePassword).toBe(true);

    const gated = await request(app)
      .get("/api/v1/auth/session-check")
      .set("Authorization", `Bearer ${first.body.accessToken}`);
    expect(gated.status).toBe(403);
    expect(gated.body.error.code).toBe("MUST_CHANGE_PASSWORD");

    const change = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${first.body.accessToken}`)
      .set("Host", HOST)
      .send({ currentPassword: SEED_PASSWORD, newPassword: "NewPassword!456" });
    expect(change.status).toBe(204);

    const again = await login(app, "tempuser", "NewPassword!456");
    expect(again.status).toBe(200);
    expect(again.body.mustChangePassword).toBe(false);
    const released = await request(app)
      .get("/api/v1/auth/session-check")
      .set("Authorization", `Bearer ${again.body.accessToken}`);
    expect(released.status).toBe(200);
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
