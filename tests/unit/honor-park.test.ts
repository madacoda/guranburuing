// tests/unit/honor-park.test.ts
import { describe, it, expect } from 'vitest';
import { HonorParkService, TEAMRAID085_HONOR_CATALOG } from '../../src/services/gw/honor-park.service.js';

describe('HonorParkService - Unite & Fight Exact Diophantine Honor Parking Solver', () => {
  it('exposes the empirically verified #event/teamraid085 honor catalog', () => {
    const byId = Object.fromEntries(TEAMRAID085_HONOR_CATALOG.map(q => [q.id, q.honors]));
    expect(byId.nm95_full).toBe(910_385);
    expect(byId.nm90_qc).toBe(310_010);
    expect(byId.ex_plus_qc).toBe(127_610);
    expect(byId.ex_plus).toBe(127_600);
    expect(byId.ex_qc).toBe(64_810);
    expect(byId.ex).toBe(64_800);
    expect(byId.very_hard).toBe(21_400);
    expect(byId.hard).toBe(8_000);
    expect(byId.normal).toBe(4_000);
  });

  it('solves the exact live user honor gap (448,624,695 -> 500,000,000) with 0 residual error', () => {
    const current = 448_624_695;
    const target = 500_000_000;
    const plan = HonorParkService.solveOptimalPlan(current, target);

    expect(plan.exactMatch).toBe(true);
    expect(plan.residualHonors).toBe(0);

    const summedHonors = plan.steps.reduce((acc, s) => acc + s.runs * s.quest.honors, 0);
    expect(current + summedHonors).toBe(target);
    expect(plan.steps[plan.steps.length - 1].cumulativeHonorsAfter).toBe(target);
    expect(plan.steps[plan.steps.length - 1].remainingHonorsAfter).toBe(0);
  });

  it('solves all earlier observed user checkpoints (393,338,175 and 445,230,120 -> 500,000,000) with 0 residual error', () => {
    for (const startHonors of [393_338_175, 445_230_120, 446_366_305, 447_276_690, 447_586_700, 448_497_085]) {
      const plan = HonorParkService.solveOptimalPlan(startHonors, 500_000_000);
      expect(plan.exactMatch).toBe(true);
      expect(plan.residualHonors).toBe(0);
      const totalAdded = plan.steps.reduce((acc, s) => acc + s.totalHonors, 0);
      expect(startHonors + totalAdded).toBe(500_000_000);
    }
  });

  it('solves every possible mod-200 residue (multiples of 5) across arbitrary honor targets', () => {
    const target = 500_000_000;
    // Test all 40 residue classes (0, 5, 10, ..., 195 mod 200)
    for (let r = 0; r < 200; r += 5) {
      const startHonors = 485_000_000 + r;
      const plan = HonorParkService.solveOptimalPlan(startHonors, target);
      expect(plan.exactMatch).toBe(true);
      expect(plan.residualHonors).toBe(0);
      const totalAdded = plan.steps.reduce((acc, s) => acc + s.totalHonors, 0);
      expect(startHonors + totalAdded).toBe(target);
    }
  });

  it('returns 0 runs when already parked at target', () => {
    const plan = HonorParkService.solveOptimalPlan(500_000_000, 500_000_000);
    expect(plan.exactMatch).toBe(true);
    expect(plan.totalRuns).toBe(0);
    expect(plan.steps.length).toBe(0);
  });
});
