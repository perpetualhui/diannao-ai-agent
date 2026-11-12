/**
 * 店脑 · 共享契约统一出口
 *
 * 主责：B 邱 ｜ 其他人不得直接修改本目录。
 * 版本：v1（2026-11-07）
 *
 * 所有人统一 import { ... } from '@dian-nao/contracts'，不自己定义同名类型。
 * 发现字段缺失或类型不对：写清「哪个端点、哪个字段、期望什么」，发给 B，不自行添加。
 */

export * from './types';
export * from './mock';

/** 契约当前版本号，B 每次更新 +1。 */
export const CONTRACTS_VERSION = 'v2' as const;
