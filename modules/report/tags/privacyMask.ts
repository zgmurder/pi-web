/** 警情展示用隐私脱敏（核对区 / 详情弹窗等只读场景） */

/** 涉黄涉赌警情小类代码（zd_bjlxdm.bjlxdm）：10180 涉黄 / 10190 涉赌 / 60100 涉黄类 / 60200 涉赌类 */
const SENSITIVE_ALARM_LX_CODES = new Set(['10180', '10190', '60100', '60200'])

/**
 * 该警情是否需要脱敏：仅涉黄涉赌警情脱敏，其余警情全文展示。
 * 后端 bjlxdm 为 DECIMAL（FastAPI 序列化为 10180.0 等数值），统一按数字串比较。
 */
export function isSensitiveAlarm(bjlxdm?: string | number | null): boolean {
  const code = String(bjlxdm ?? '').trim()
  if (!code) return false
  return SENSITIVE_ALARM_LX_CODES.has(code) || SENSITIVE_ALARM_LX_CODES.has(code.replace(/\.0+$/, ''))
}

/**
 * 行级脱敏判定（研判包 / 警情打标共用口径）：
 * 优先用后端 `sensitive` 标记（警情小类或反馈类别/类型/细类涉黄涉赌），
 * 字段缺失时兜底本地 bjlxdm 判断。
 */
export function isRowSensitive(
  row?: { sensitive?: boolean | null; bjlxdm?: string | number | null } | null
): boolean {
  if (!row) return false
  if (row.sensitive === true) return true
  return isSensitiveAlarm(row.bjlxdm)
}

const NAME_CHAR = '[\\u4e00-\\u9fa5·]'
/** 角色词（较长词放前面，避免「当事人」误匹配「其他当事人」） */
const ROLE_WORD = '(?:其他当事人|报警人|当事人|受害人|嫌疑人|涉事人|见证人|被害人)'
const ROLE_PREFIX = ROLE_WORD

/** 不应被当作姓名的常见片段（段落标题、职务等） */
const NAME_BLOCKLIST = new Set([
  '当事人',
  '当事人信息',
  '警情内容',
  '处置情况',
  '处警信息',
  '发生地址',
  '浙江省',
  '派出所',
  '民警',
  '辅警',
  '匿名'
])

export function maskPersonName(name?: string | null) {
  const text = String(name || '').trim()
  if (!text) return text
  if (NAME_BLOCKLIST.has(text)) return text
  if (text.length === 1) return '*'
  if (text.length === 2) return `${text[0]}*`
  if (text.length === 3) return `${text[0]}*${text[2]}`
  return `${text[0]}${'*'.repeat(Math.max(1, text.length - 2))}${text[text.length - 1]}`
}

export function maskIdNo(idNo?: string | null) {
  const text = String(idNo || '').trim()
  if (!text) return text
  if (text.length === 18) return `${text.slice(0, 4)}**********${text.slice(-4)}`
  if (text.length === 15) return `${text.slice(0, 6)}*****${text.slice(-4)}`
  if (text.length > 8) return `${text.slice(0, 4)}****${text.slice(-4)}`
  return text
}

export function maskPhone(phone?: string | null) {
  const digits = String(phone || '').trim().replace(/\D/g, '')
  if (!digits) return String(phone || '').trim()
  if (digits.length === 11) return `${digits.slice(0, 3)}****${digits.slice(-4)}`
  if (digits.length >= 7) return `${digits.slice(0, 3)}****${digits.slice(-2)}`
  return digits
}

function shouldMaskNameCandidate(name: string) {
  const text = String(name || '').trim()
  if (!text || text.length < 2 || text.length > 8) return false
  if (NAME_BLOCKLIST.has(text)) return false
  if (/^\d+$/.test(text)) return false
  if (/[省市县区镇街道村路号楼栋单元室]/.test(text)) return false
  return true
}

function maskNamesInText(text: string, names: string[]) {
  let result = text
  const unique = [...new Set(names.map((item) => item.trim()).filter((item) => item.length >= 2))].sort(
    (a, b) => b.length - a.length
  )
  unique.forEach((name) => {
    if (!shouldMaskNameCandidate(name)) return
    result = result.split(name).join(maskPersonName(name))
  })
  return result
}

/** 常见文书格式中的姓名（须在身份证/手机号脱敏之前执行） */
function maskNamePatternsInText(text: string) {
  let result = text

  // 姓名：江书京 / 姓名江书京
  result = result.replace(
    new RegExp(`姓名[：:\\s]*(${NAME_CHAR}{2,8})`, 'g'),
    (_, name: string) => `姓名${maskPersonName(name)}`
  )

  // 1.报警人、其他当事人：江书京、男、1995年08月
  result = result.replace(
    new RegExp(
      `(?:\\d+[.．、]\\s*)?(?:${ROLE_WORD})(?:[、,，](?:${ROLE_WORD}))*[：:]\\s*(${NAME_CHAR}{2,8})(?=[、,，])`,
      'g'
    ),
    (match, name: string) => {
      if (!shouldMaskNameCandidate(name)) return match
      return match.replace(name, maskPersonName(name))
    }
  )

  // 同上行的性别、出生年月：、男、1995年08月
  result = result.replace(/、(男|女)、\d{4}年\d{1,2}月/g, (_, gender: string) => `、${gender}、****年**月`)

  // 报警人【江书京 3623... / 当事人【张三
  result = result.replace(
    new RegExp(`(${ROLE_PREFIX})[【\\[]\\s*(${NAME_CHAR}{2,8})(?=\\s|[\\]】\\d，,。；;])`, 'g'),
    (match, role: string, name: string) => {
      if (!shouldMaskNameCandidate(name)) return match
      return `${role}【${maskPersonName(name)}`
    }
  )

  // 【江书京 362329...】括号内「姓名 + 证件/电话」
  result = result.replace(
    new RegExp(`【\\s*(${NAME_CHAR}{2,8}?)\\s+(?=\\d{15,17}[\\dXx]?|1[3-9]\\d{9})`, 'g'),
    (_, name: string) => {
      if (!shouldMaskNameCandidate(name)) return `【${name}`
      return `【${maskPersonName(name)} `
    }
  )

  // 文本中「称江书京来所」「叫张三」
  result = result.replace(
    new RegExp(`(称|叫)(${NAME_CHAR}{2,4})(?=[来来到向与和，,。；;\\s])`, 'g'),
    (_, prefix: string, name: string) => {
      if (!shouldMaskNameCandidate(name)) return `${prefix}${name}`
      return `${prefix}${maskPersonName(name)}`
    }
  )

  // 交通/纠纷类：(男, 江书京, 3307...) / 江书京(男
  result = result.replace(
    new RegExp(`[（(]\\s*(?:男|女)[，,]\\s*(${NAME_CHAR}{2,4})[，,]`, 'g'),
    (_, name: string) => `(男, ${maskPersonName(name)},`
  )
  result = result.replace(
    new RegExp(`(${NAME_CHAR}{2,4})\\s*[（(]\\s*(?:男|女)`, 'g'),
    (_, name: string) => {
      if (!shouldMaskNameCandidate(name)) return `${name}(男`
      return `${maskPersonName(name)}(男`
    }
  )

  return result
}

/** 处警情况文本脱敏：姓名、身份证、手机号、门牌楼层等 */
export function maskCjqkText(
  text?: string | null,
  options?: {
    personNames?: Array<string | null | undefined>
  }
) {
  let result = String(text || '')
  if (!result) return result

  // 1. 先脱敏姓名（依赖原文中的证件号/手机号定位）
  result = maskNamePatternsInText(result)
  const names = (options?.personNames || []).map((item) => String(item || '').trim()).filter(Boolean)
  result = maskNamesInText(result, names)

  // 2. 证件号、电话
  result = result.replace(/(^|\D)(\d{17}[\dXx])(?!\d)/g, (_, prefix: string, value: string) => prefix + maskIdNo(value))
  result = result.replace(/(^|\D)(\d{15})(?!\d)/g, (_, prefix: string, value: string) => prefix + matchId15(value))
  result = result.replace(/(^|\D)(1[3-9]\d{9})(?!\d)/g, (_, prefix: string, value: string) => prefix + maskPhone(value))
  result = result.replace(/(^|\D)(0\d{2,3}-?\d{7,8})(?!\d)/g, (_, prefix: string, value: string) => prefix + maskPhone(value))

  // 3. 结构化字段（兜底）
  result = result.replace(/证件号码[：:]\s*([\dXx]{15,18})/gi, (_, id: string) => `证件号码：${maskIdNo(id)}`)
  result = result.replace(/联系电话[：:]\s*([\d\-]{7,18})/g, (_, phone: string) => `联系电话：${maskPhone(phone)}`)
  result = result.replace(/现住地[：:]\s*([^\n【]+)/g, (_, address: string) => {
    const trimmed = String(address || '').trim()
    if (trimmed.length <= 6) return `现住地：${trimmed}`
    return `现住地：${trimmed.slice(0, 6)}****`
  })

  // 4. 门牌、楼层等细节
  result = result.replace(/\d+号\d*楼?/g, '**号**楼')
  result = result.replace(/([街道镇乡村路巷弄])\d+/g, '$1**')

  return result
}

function matchId15(value: string) {
  return /^\d{15}$/.test(value) ? maskIdNo(value) : value
}
