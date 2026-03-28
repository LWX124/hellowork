// tests/service/machines.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { MachinesStore } from '../../src/service/store/machines'

const TEST_DIR = '/tmp/hellowork-test'

describe('MachinesStore', () => {
  let store: MachinesStore

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
    store = new MachinesStore(join(TEST_DIR, 'machines.json'))
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('returns empty array when no file exists', () => {
    expect(store.getAll()).toEqual([])
  })

  it('saves and retrieves a machine', () => {
    const machine = {
      id: 'test-1', name: 'Test', host: '100.0.0.1',
      port: 22, username: 'user',
      auth: { type: 'key' as const, keyPath: '~/.ssh/id_rsa' }
    }
    store.save(machine)
    expect(store.getAll()).toHaveLength(1)
    expect(store.getById('test-1')).toMatchObject({ name: 'Test' })
  })

  it('updates an existing machine', () => {
    const machine = {
      id: 'test-1', name: 'Test', host: '100.0.0.1',
      port: 22, username: 'user',
      auth: { type: 'key' as const, keyPath: '~/.ssh/id_rsa' }
    }
    store.save(machine)
    store.save({ ...machine, name: 'Updated' })
    expect(store.getAll()).toHaveLength(1)
    expect(store.getById('test-1')?.name).toBe('Updated')
  })

  it('deletes a machine', () => {
    const machine = {
      id: 'test-1', name: 'Test', host: '100.0.0.1',
      port: 22, username: 'user',
      auth: { type: 'key' as const, keyPath: '~/.ssh/id_rsa' }
    }
    store.save(machine)
    store.delete('test-1')
    expect(store.getAll()).toHaveLength(0)
  })
})
