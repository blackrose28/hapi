import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { SharedHubStore } from "../store/sharedHubStore";
import {
  RunnerEnrollmentError,
  RunnerEnrollmentService,
} from "./runnerEnrollmentService";
import { keyedHash } from "../auth/identityCrypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function setup() {
  const db = new Database(":memory:");
  const store = new SharedHubStore(db, {
    organizationId: "o1",
    organizationName: "Pilot",
  });
  db.exec(
    "INSERT INTO memberships(id,organization_id,invited_email,role,status,created_at) VALUES('u1','o1','u@example.com','admin','active',1)",
  );
  const service = new RunnerEnrollmentService(
    store,
    "pepper",
    "https://hub.test",
    () => 1000,
  );
  return {
    db,
    store,
    service,
    subject: {
      membershipId: "u1",
      organizationId: "o1",
      role: "admin" as const,
      disabled: false,
    },
  };
}
const exchange = (code: string, machine = "m1", profile = "p1") => ({
  code,
  profile,
  machine: {
    id: machine,
    name: "Laptop",
    platform: "linux" as const,
    arch: "x64" as const,
  },
});
describe("RunnerEnrollmentService", () => {
  it("lets members manage only their own enrollments", () => {
    const { db, service, subject } = setup();
    db.exec("INSERT INTO memberships(id,organization_id,invited_email,role,status,created_at) VALUES('u2','o1','member@example.com','member','active',1),('u3','o1','other@example.com','member','active',1)");
    const member = { membershipId: "u2", organizationId: "o1", role: "member" as const, disabled: false };
    const otherMember = { membershipId: "u3", organizationId: "o1", role: "member" as const, disabled: false };
    const owned = service.issue(member, "u1");
    service.issue(subject, "u1");
    expect(service.list(member).enrollments.map((enrollment) => enrollment.id)).toEqual([owned.enrollmentId]);
    expect(() => service.cancel(otherMember, owned.enrollmentId)).toThrow("forbidden");
    service.cancel(member, owned.enrollmentId);
    expect(service.list(member).enrollments[0]?.cancelled).toBe(true);
  });
  it("rejects viewers from enrollment management", () => {
    const { service } = setup();
    const viewer = { membershipId: "u1", organizationId: "o1", role: "viewer" as const, disabled: false };
    expect(() => service.issue(viewer)).toThrow("forbidden");
    expect(() => service.list(viewer)).toThrow("forbidden");
  });
  it("uses exact TTL, hashes code, and permits only one exchange", () => {
    const { db, service, subject } = setup();
    const issued = service.issue(subject, "u1");
    expect(issued.expiresAt).toBe(901000);
    expect(
      JSON.stringify(db.prepare("SELECT * FROM runner_enrollments").get()),
    ).not.toContain(issued.code);
    expect(service.exchange(exchange(issued.code)).generation).toBe(1);
    expect(() => service.exchange(exchange(issued.code, "m2", "p2"))).toThrow(
      RunnerEnrollmentError,
    );
  });
  it("rechecks active owner and rolls back a known claim conflict", () => {
    const { db, service, subject } = setup();
    const first = service.issue(subject, "u1");
    service.exchange(exchange(first.code));
    const second = service.issue(subject, "u1");
    expect(() => service.exchange(exchange(second.code, "m2", "p1"))).toThrow(
      "profile_claimed",
    );
    expect(
      db
        .prepare("SELECT consumed_at FROM runner_enrollments WHERE id=?")
        .get(second.enrollmentId),
    ).toEqual({ consumed_at: null });
    db.exec("UPDATE memberships SET status='disabled' WHERE id='u1'");
    const thirdCode = "inactive-owner-code-000000";
    storeCode(db, thirdCode);
    expect(() => service.exchange(exchange(thirdCode, "m3", "p3"))).toThrow(
      "enrollment_used",
    );
  });
  it("rolls back consume, projection and credential when a post-insert failure occurs", () => {
    const { db, store, subject } = setup();
    const failing = new RunnerEnrollmentService(
      store,
      "pepper",
      "https://hub.test",
      () => 1000,
      () => {
        throw new Error("injected");
      },
    );
    const issued = failing.issue(subject, "u1");
    expect(() => failing.exchange(exchange(issued.code))).toThrow("injected");
    expect(db.prepare("SELECT count(*) count FROM runners").get()).toEqual({
      count: 0,
    });
    expect(
      db.prepare("SELECT count(*) count FROM runner_credentials").get(),
    ).toEqual({ count: 0 });
    expect(
      db
        .prepare(
          "SELECT count(*) count FROM audit_events WHERE action='runner.enroll'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      db
        .prepare(
          "SELECT count(*) count FROM outbox_events WHERE name='runner.enrolled'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      new RunnerEnrollmentService(
        store,
        "pepper",
        "https://hub.test",
        () => 1000,
      ).exchange(exchange(issued.code)).generation,
    ).toBe(1);
  });
  it("has one stable winner across overlapping file-database connections", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hapi-enroll-"));
    const path = join(dir, "hub.db"),
      barrier = join(dir, "go");
    try {
      const db = new Database(path);
      const store = new SharedHubStore(db, {
        organizationId: "o1",
        organizationName: "Pilot",
      });
      db.exec(
        "PRAGMA busy_timeout=5000; INSERT INTO memberships(id,organization_id,invited_email,role,status,created_at) VALUES('u1','o1','u@example.com','admin','active',1)",
      );
      const subject = {
        membershipId: "u1",
        organizationId: "o1",
        role: "admin" as const,
        disabled: false,
      };
      const issued = new RunnerEnrollmentService(
        store,
        "pepper",
        "https://hub.test",
        () => 1000,
      ).issue(subject, "u1");
      db.close();
      const script = `import {Database} from 'bun:sqlite';import {existsSync,writeFileSync} from 'node:fs';import {SharedHubStore} from '${new URL("../store/sharedHubStore.ts", import.meta.url).href}';import {RunnerEnrollmentService} from '${new URL("./runnerEnrollmentService.ts", import.meta.url).href}';const db=new Database(process.env.DB!);db.exec('PRAGMA busy_timeout=5000');const s=new SharedHubStore(db,{organizationId:'o1',organizationName:'Pilot'});writeFileSync(process.env.READY!,'ready');while(!existsSync(process.env.GO!))await Bun.sleep(1);try{const r=new RunnerEnrollmentService(s,'pepper','https://hub.test',()=>1000).exchange({code:process.env.CODE!,profile:'p1',machine:{id:'m1',name:'M',platform:'linux',arch:'x64'}});console.log(JSON.stringify({ok:true,runnerId:r.runnerId}))}catch(e){console.log(JSON.stringify({ok:false,code:e?.code??'unknown'}))}`;
      const spawn = (ready: string) =>
        Bun.spawn(["bun", "-e", script], {
          env: { ...process.env, DB: path, GO: barrier, READY: ready, CODE: issued.code },
          stdout: "pipe",
          stderr: "pipe",
        });
      const readyA=join(dir,'ready-a'),readyB=join(dir,'ready-b');
      const a = spawn(readyA);
      while(!existsSync(readyA))await Bun.sleep(1);
      const b = spawn(readyB);
      while(!existsSync(readyB))await Bun.sleep(1);
      writeFileSync(barrier, "go");
      const results = await Promise.all(
        [a, b].map(async (p) => {
          const text = await new Response(p.stdout).text();
          const stderr = await new Response(p.stderr).text();
          await p.exited;
          if (!text.trim()) throw new Error(stderr);
          return JSON.parse(text.trim()) as { ok: boolean; code?: string };
        }),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)?.code).toBe("enrollment_used");
      const verify = new Database(path);
      expect(
        verify.prepare("SELECT count(*) count FROM runners").get(),
      ).toEqual({ count: 1 });
      expect(
        verify.prepare("SELECT count(*) count FROM runner_credentials").get(),
      ).toEqual({ count: 1 });
      expect(
        verify
          .prepare(
            "SELECT count(*) count FROM audit_events WHERE action='runner.enroll'",
          )
          .get(),
      ).toEqual({ count: 1 });
      expect(
        verify
          .prepare(
            "SELECT count(*) count FROM outbox_events WHERE name='runner.enrolled'",
          )
          .get(),
      ).toEqual({ count: 1 });
      verify.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});
function storeCode(db: Database, code: string) {
  db.prepare(
    "INSERT INTO runner_enrollments(id,organization_id,created_by_membership_id,code_hash,expires_at,created_at) VALUES('e3','o1','u1',?,2000,1)",
  ).run(keyedHash(code, "pepper"));
}
