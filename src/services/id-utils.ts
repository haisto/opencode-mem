/**
 * ID 格式工具函数
 *
 * 提供 memory ID 和 prompt ID 的格式检测与判断能力，
 * 用于在 API 层区分精确搜索（按 ID 查找）与语义搜索。
 */

/** Memory ID 正则：mem_<timestamp>_<9位字母数字随机> */
const MEMORY_ID_RE = /^mem_\d+_[a-z0-9]{9}$/;

/** Prompt ID 正则：prompt_<timestamp>_<7位字母数字随机> */
const PROMPT_ID_RE = /^prompt_\d+_[a-z0-9]{7}$/;

/**
 * 判断字符串是否为合法的 memory ID 格式
 *
 * @param id - 待检测的字符串
 * @returns 如果是 memory ID 格式返回 true，否则返回 false
 */
export function isMemoryId(id: string): boolean {
  return MEMORY_ID_RE.test(id);
}

/**
 * 判断字符串是否为合法的 prompt ID 格式
 *
 * @param id - 待检测的字符串
 * @returns 如果是 prompt ID 格式返回 true，否则返回 false
 */
export function isPromptId(id: string): boolean {
  return PROMPT_ID_RE.test(id);
}

/**
 * 判断字符串是否为合法的 memory ID 或 prompt ID 格式
 *
 * @param id - 待检测的字符串
 * @returns 如果是 memory ID 或 prompt ID 格式返回 true，否则返回 false
 */
export function isId(id: string): boolean {
  return isMemoryId(id) || isPromptId(id);
}
