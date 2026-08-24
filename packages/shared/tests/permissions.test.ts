import { describe, expect, it } from "vitest";
import { principalCan, resolvePrincipal, type AssignmentInput } from "../src/auth";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-01-15T10:00:00Z");

function assignment(overrides: Partial<AssignmentInput> = {}): AssignmentInput {
  return {
    roleKey: "collection_officer",
    scopeType: "single_branch",
    branchIds: ["branch-1"],
    assignmentType: "permanent",
    status: "active",
    startsAt: new Date(NOW.getTime() - 2 * DAY),
    endsAt: null,
    ...overrides
  };
}

describe("stage 2 permission merge engine", () => {
  it("unions permissions across simultaneous active assignments (no highest-role-wins)", () => {
    const p = resolvePrincipal({
      userId: "u1",
      companyId: "c1",
      branchId: "branch-1",
      now: NOW,
      assignments: [
        { ...assignment(), permissions: ["view", "create"] },
        {
          ...assignment({ roleKey: "branch_manager", assignmentType: "temporary" }),
          permissions: ["view", "approve"]
        }
      ]
    });
    expect([...p.permissions].sort()).toEqual(["approve", "create", "view"]);
  });

  it("excludes temporary assignments outside their window", () => {
    const p = resolvePrincipal({
      userId: "u1",
      companyId: "c1",
      branchId: null,
      now: NOW,
      assignments: [
        assignment({ permissions: ["view", "create"] }),
        assignment({
          roleKey: "branch_manager",
          assignmentType: "temporary",
          startsAt: new Date(NOW.getTime() + DAY),
          endsAt: new Date(NOW.getTime() + 2 * DAY),
          permissions: ["approve"]
        })
      ]
    });
    expect(p.permissions).toEqual(["view", "create"]);
    expect(p.roles).toHaveLength(1);
  });

  it("excludes ended assignments even if the window would still cover now", () => {
    const p = resolvePrincipal({
      userId: "u1",
      companyId: "c1",
      branchId: null,
      now: NOW,
      assignments: [
        assignment({
          status: "ended"
        })
      ]
    });
    expect(p.roles).toHaveLength(0);
  });

  it("a restriction on one role never downgrades another role's grant", () => {
    // collection_officer has no approve; branch_manager does. The CO role's
    // narrow scope must not remove BM's grant at that same branch.
    const p = resolvePrincipal({
      userId: "u1",
      companyId: "c1",
      branchId: "branch-1",
      now: NOW,
      assignments: [
        assignment({ permissions: ["view"], scopeType: "assigned_customers_groups_loans" }),
        assignment({
          roleKey: "branch_manager",
          permissions: ["view", "approve"],
          assignmentType: "temporary"
        })
      ]
    });
    expect(principalCan(p, "approve", "branch-1")).toBe(true);
    // assigned-scope never covers concrete branches by itself
    expect(principalCan(p, "view", "branch-9")).toBe(false);
  });

  it("multi-branch scope covers only listed branches; company-wide covers everything", () => {
    const multi = resolvePrincipal({
      userId: "u1",
      companyId: "c1",
      branchId: null,
      now: NOW,
      assignments: [
        assignment({
          scopeType: "multi_branch",
          branchIds: ["b1", "b2"],
          permissions: ["view"]
        })
      ]
    });
    expect(principalCan(multi, "view", "b1")).toBe(true);
    expect(principalCan(multi, "view", "b3")).toBe(false);

    const wide = resolvePrincipal({
      userId: "u2",
      companyId: "c1",
      branchId: null,
      now: NOW,
      assignments: [assignment({ scopeType: "company_wide", branchIds: [], permissions: ["suspend"] })]
    });
    expect(principalCan(wide, "suspend", "anywhere")).toBe(true);
  });
});
