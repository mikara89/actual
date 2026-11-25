import { send } from '@actual-app/core/platform/client/connection';
import type { Query } from '@actual-app/core/shared/query';
import type { TransactionEntity } from '@actual-app/core/types/models';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetTestProviders, TestProviders } from '#mocks';

import { useTransactionBatchActions } from './useTransactionBatchActions';

let transactions: TransactionEntity[] = [];
let queriedTables: string[] = [];

vi.mock('#queries/aqlQuery', () => ({
  aqlQuery: (query: Query) => {
    queriedTables.push(query.state.table);
    if (query.state.table !== 'transactions') {
      throw new Error(`Unexpected query table: ${query.state.table}`);
    }
    return Promise.resolve({ data: transactions });
  },
}));

vi.mock('@actual-app/core/platform/client/connection', () => ({
  send: vi.fn(() => Promise.resolve()),
}));

const baseTransaction = (
  overrides: Partial<TransactionEntity>,
): TransactionEntity =>
  ({
    id: 'trans-1',
    account: 'acct-1',
    date: '2026-01-02',
    amount: -1234,
    payee: 'payee-1',
    category: 'cat-1',
    notes: 'original notes',
    imported_id: null,
    schedule: null,
    cleared: true,
    reconciled: true,
    sort_order: 1,
    ...overrides,
  }) as TransactionEntity;

const splitParent = (overrides: Partial<TransactionEntity> = {}) =>
  baseTransaction({
    id: 'parent-1',
    is_parent: true,
    subtransactions: [
      baseTransaction({
        id: 'child-1',
        is_child: true,
        parent_id: 'parent-1',
        amount: -1234,
        category: 'cat-1',
      }),
    ],
    ...overrides,
  });

const renderBatchActions = () =>
  renderHook(() => useTransactionBatchActions(), {
    wrapper: TestProviders,
  });

const batchUpdateChanges = () =>
  vi.mocked(send).mock.calls.find(([name]) => name === 'transactions-batch-update')!
    [1] as { added: TransactionEntity[] };

describe('useTransactionBatchActions onBatchDuplicate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTestProviders();
    transactions = [];
    queriedTables = [];
  });

  it('drops imported_id on the parent and every split child', async () => {
    transactions = [
      splitParent({ imported_id: 'bank-1', subtransactions: [
        baseTransaction({
          id: 'child-1',
          is_child: true,
          parent_id: 'parent-1',
          imported_id: 'bank-1',
        }),
      ] }),
    ];

    const { result } = renderBatchActions();
    await act(() =>
      result.current.onBatchDuplicate({ ids: ['parent-1'] }),
    );

    const added = batchUpdateChanges().added;
    expect(added).toHaveLength(2);
    expect(added.every(t => t.imported_id === null)).toBe(true);
  });

  it('drops imported_id on a non-split transaction', async () => {
    transactions = [baseTransaction({ id: 'plain-1', imported_id: 'bank-2' })];

    const { result } = renderBatchActions();
    await act(() => result.current.onBatchDuplicate({ ids: ['plain-1'] }));

    const added = batchUpdateChanges().added;
    expect(added).toHaveLength(1);
    expect(added[0].imported_id).toBeNull();
  });

  it('keeps the non-bank data and the split structure', async () => {
    transactions = [
      splitParent({ imported_id: 'bank-1', subtransactions: [
        baseTransaction({
          id: 'child-1',
          is_child: true,
          parent_id: 'parent-1',
          imported_id: 'bank-1',
        }),
      ] }),
    ];

    const { result } = renderBatchActions();
    await act(() => result.current.onBatchDuplicate({ ids: ['parent-1'] }));

    const added = batchUpdateChanges().added;
    const parent = added.find(t => !t.is_child)!;
    const child = added.find(t => t.is_child)!;

    expect(parent.account).toBe('acct-1');
    expect(parent.date).toBe('2026-01-02');
    expect(parent.amount).toBe(-1234);
    expect(parent.payee).toBe('payee-1');
    expect(parent.category).toBe('cat-1');
    expect(parent.notes).toBe('original notes');
    expect(child.amount).toBe(-1234);
    expect(child.category).toBe('cat-1');
    expect(child.parent_id).toBe(parent.id);
  });

  it('drops the schedule link on the parent and every split child', async () => {
    transactions = [
      splitParent({ schedule: 'sched-1', subtransactions: [
        baseTransaction({
          id: 'child-1',
          is_child: true,
          parent_id: 'parent-1',
          schedule: 'sched-1',
        }),
      ] }),
    ];

    const { result } = renderBatchActions();
    await act(() => result.current.onBatchDuplicate({ ids: ['parent-1'] }));

    const added = batchUpdateChanges().added;
    expect(added).toHaveLength(2);
    expect(added.every(t => t.schedule === null)).toBe(true);
  });

  it('drops the schedule link on a non-split transaction', async () => {
    transactions = [baseTransaction({ id: 'plain-1', schedule: 'sched-1' })];

    const { result } = renderBatchActions();
    await act(() => result.current.onBatchDuplicate({ ids: ['plain-1'] }));

    const added = batchUpdateChanges().added;
    expect(added).toHaveLength(1);
    expect(added[0].schedule).toBeNull();
  });

  it('does not look up schedules or rules and drops an unknown schedule id', async () => {
    transactions = [
      baseTransaction({ id: 'plain-1', schedule: 'does-not-exist' }),
    ];

    const { result } = renderBatchActions();
    await act(() => result.current.onBatchDuplicate({ ids: ['plain-1'] }));

    expect(queriedTables).toEqual(['transactions']);
    expect(batchUpdateChanges().added[0].schedule).toBeNull();
  });

  it('resets cleared/reconciled, assigns fresh ids and relinks children', async () => {
    transactions = [splitParent({ imported_id: 'bank-1' })];

    const { result } = renderBatchActions();
    await act(() => result.current.onBatchDuplicate({ ids: ['parent-1'] }));

    const added = batchUpdateChanges().added;
    const parent = added.find(t => !t.is_child)!;
    const child = added.find(t => t.is_child)!;

    expect(added.every(t => t.cleared === false)).toBe(true);
    expect(added.every(t => t.reconciled === false)).toBe(true);
    expect(parent.id).not.toBe('parent-1');
    expect(child.id).not.toBe('child-1');
    expect(child.parent_id).toBe(parent.id);
  });

  it('calls onSuccess once with the original selected ids', async () => {
    transactions = [baseTransaction({ id: 'plain-1' })];
    const onSuccess = vi.fn();

    const { result } = renderBatchActions();
    await act(() =>
      result.current.onBatchDuplicate({ ids: ['plain-1'], onSuccess }),
    );

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(['plain-1']);
  });

  it('adds one parent plus its children per selected transaction', async () => {
    transactions = [
      splitParent({ id: 'parent-1' }),
      baseTransaction({ id: 'plain-2' }),
    ];

    const { result } = renderBatchActions();
    await act(() =>
      result.current.onBatchDuplicate({ ids: ['parent-1', 'plain-2'] }),
    );

    const added = batchUpdateChanges().added;
    expect(added).toHaveLength(3);
    expect(added.filter(t => !t.is_child)).toHaveLength(2);
    expect(added.filter(t => t.is_child)).toHaveLength(1);
  });
});
