<script setup lang="ts">
// 拼装日接线 patch（INTEGRATION PATCH）—— 待罗（C）复核
// 改动：登录/搜索/档案/记录 四处从纯本地 mock 切到邱的 API，失败降级本地模式（铁律 9）。
// SearchPanel 增加 remote prop 与 search 事件（见 SearchPanel.vue patch）。
import { computed, reactive, shallowRef } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import SearchPanel from './components/SearchPanel.vue'
import CustomerDetail from './components/CustomerDetail.vue'
import NoteForm from './components/NoteForm.vue'
import { demoCustomers, type Customer } from './demo-data'
import {
  apiLogin, apiRegister, apiResolve, apiGetSummary, apiCreateDraft,
  summaryToCustomer, candidateToCustomer,
  hasSession, clearSession, authToken,
} from './api-client'

const account = reactive({ username: '', password: '' })
const role = shallowRef<'staff' | 'manager' | null>(null)
const remoteMode = shallowRef(false)          // true = 已连上邱的 API
const selectedId = shallowRef<string | null>(null)
const loading = shallowRef(false)
const customers = shallowRef<Customer[]>(structuredClone(demoCustomers))
const selected = computed(() => customers.value.find(c => c.id === selectedId.value) ?? null)

async function login() {
  loading.value = true
  try {
    const { role: r } = await apiLogin(account.username, account.password)
    role.value = r
    remoteMode.value = true
    customers.value = []
    account.password = ''
    ElMessage.success('已登录')
    void loadOverview()
  } catch {
    ElMessage.error('账号或密码不正确')
  } finally {
    loading.value = false
  }
}
function logout() {
  role.value = null; selectedId.value = null
  account.username = ''; account.password = ''
  if (hasSession()) clearSession()
  remoteMode.value = false
  customers.value = structuredClone(demoCustomers)
}

// 远程搜索：调 identity/resolve，候选/命中都映射为 Customer 列表
async function onSearch(query: string) {
  if (!remoteMode.value) return            // 本地模式由 SearchPanel 自己过滤
  loading.value = true
  try {
    const result = await apiResolve(query)
    if (result.match_status === 'not_found') {
      customers.value = []
      ElMessage.info('未找到匹配客户')
      return
    }
    if (result.match_status === 'matched' && result.resolved_subject_ref) {
      const summary = await apiGetSummary(result.resolved_subject_ref)
      customers.value = [summaryToCustomer(summary)]
      selectedId.value = summary.subject_ref
      return
    }
    // ambiguous：只给脱敏候选，点击后再拉档案（服务端校验租户）
    customers.value = result.candidates.map(candidateToCustomer)
    selectedId.value = null
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '搜索失败')
  } finally {
    loading.value = false
  }
}

// 选中候选：远程模式拉完整档案（歧义确认后）；本地模式直接用现有数据
async function onSelect(id: string) {
  selectedId.value = id
  if (!remoteMode.value) return
  loading.value = true
  try {
    const summary = await apiGetSummary(id)
    const full = summaryToCustomer(summary)
    customers.value = customers.value.map(c => c.id === id ? full : c)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '档案加载失败')
  } finally {
    loading.value = false
  }
}

async function saveNote(text: string) {
  if (!selected.value || !role.value) return
  const note = { id: `pending`, text, date: new Date().toLocaleString('zh-CN'), author: `${role.value === 'manager' ? '店长' : '店员'} · 模拟` }
  if (remoteMode.value) {
    try {
      loading.value = true
      const receipt = await apiCreateDraft(selected.value.id, text)
      ElMessage.success(`服务记录已保存为草稿（${receipt.status}，trace ${receipt.trace_id.slice(0, 18)}…）`)
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : '保存失败：未写入，请重试')   // 失败不显示成功（铁律 7）
      return
    } finally { loading.value = false }
  } else {
    ElMessage.success('模拟记录已保存；刷新页面后重置')
  }
  customers.value = customers.value.map(c => c.id === selectedId.value
    ? { ...c, notes: [{ ...note, id: `note-${Date.now()}` }, ...c.notes] }
    : c)
}


// 后台：查看 SQLite 存储状态
async function showStorage() {
  try {
    const res = await fetch('/v1/admin/storage', {
      headers: authToken() ? { Authorization: 'Bearer ' + authToken() } : {},
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    const c = d.counts;
    const lines = [
      '存储引擎：SQLite',
      '快照：' + (d.snapshot.exists ? '已落盘 · ' + d.snapshot.updated_at : '尚未生成'),
      '大小：' + (d.snapshot.bytes ?? 0) + ' 字节',
      '',
      '客户画像：' + c.subjects,
      '成员关系：' + c.memberships,
      '商品：' + c.products,
      '知识条目：' + c.knowledge,
      '服务草稿：' + c.drafts,
      '审计日志：' + c.audit_logs,
    ];
    ElMessageBox.alert(lines.join('\n'), '数据存储状态', { confirmButtonText: '知道了' });
  } catch (e) {
    ElMessage.error('读取存储状态失败：' + (e instanceof Error ? e.message : e));
  }
}

// 后台：查看已绑定的微信账户
async function showBindings() {
  try {
    const res = await fetch('/v1/admin/bindings', {
      headers: authToken() ? { Authorization: 'Bearer ' + authToken() } : {},
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    const items: { sender_id: string; login_name: string; label: string }[] = d.items ?? [];
    const text = items.length
      ? items.map((u, i) => `${i + 1}. ${u.label}\n   微信 ${u.sender_id} → 账号 ${u.login_name}`).join('\n\n')
      : '暂无绑定用户。\n请到「配置我的店」生成绑定二维码。';
    ElMessageBox.alert(text, `微信绑定账户（${items.length} 人）`, {
      confirmButtonText: '知道了',
      customStyle: { whiteSpace: 'pre-wrap', maxWidth: '520px' },
    });
  } catch (e) {
    ElMessage.error('读取绑定列表失败：' + (e instanceof Error ? e.message : e));
  }
}

// 后台：解绑一个微信账户
async function unbindBinding() {
  try {
    const { value } = await ElMessageBox.prompt('输入要解绑的微信 sender_id（可在绑定列表里复制）', '解绑微信账户', {
      confirmButtonText: '解绑',
      cancelButtonText: '取消',
      inputPlaceholder: '例如 wxid-xxxx',
    });
    const senderId = (value || '').trim();
    if (!senderId) return;
    const res = await fetch('/v1/admin/bindings/unbind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authToken() ? { Authorization: 'Bearer ' + authToken() } : {}) },
      body: JSON.stringify({ sender_id: senderId }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.message || ('HTTP ' + res.status));
    ElMessage.success('已解绑：' + senderId);
  } catch (e) {
    if (e === 'cancel' || e === 'close') return;
    ElMessage.error('解绑失败：' + (e instanceof Error ? e.message : e));
  }
}

// 后台入口：接口已就绪，前端页面待接入。如实提示，不假装可用。
function backendTip(name: string) {
  ElMessage.info(`${name}：后端接口已就绪，前端页面待接入。当前可用的是「客户接待」；日常查客户、记记录请直接在微信里找店脑 ClawBot。`)
}

// ── 后台：页面切换与数据 ──────────────────────────────
interface OverviewData {
  staff_count: number | null; binding_count: number | null; customer_count: number
  product_count: number; draft_count: number; knowledge_count: number
  storage: { exists: boolean; updated_at?: string; bytes?: number } | null
}
interface StaffItem { login_name: string; role: string; tenant_id: string | null; revoked: boolean }
interface BindingItem { sender_id: string; login_name: string; label: string }

const activeView = shallowRef<'overview' | 'reception' | 'staff' | 'bindings' | 'storage'>('overview')
const overview = shallowRef<OverviewData | null>(null)
const persona = shallowRef<string>('baby')
const staffList = shallowRef<StaffItem[]>([])
const bindings = shallowRef<BindingItem[]>([])
const newStaff = reactive({ login_name: '', password: '', scene: 'baby', prompt_type: 'baby' })
const pageTitle = computed(() => ({ overview: '概览', reception: '客户接待', staff: '员工管理', bindings: '微信绑定', storage: '数据存储' }[activeView.value]))

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(authToken() ? { Authorization: 'Bearer ' + authToken() } : {}), ...((init?.headers as Record<string, string>) ?? {}) },
  })
  const data: unknown = await res.json().catch(() => ({}))
  if (res.status === 401) {
    ElMessage.error("登录已失效，请重新登录后再操作")
    logout()
    throw new Error("登录已失效")
  }
  if (!res.ok) throw new Error(((data as { message?: string }).message) || ('HTTP ' + res.status))
  return data as T
}
async function loadOverview() { try { const d = await apiFetch<OverviewData & { prompt_type?: string }>('/v1/admin/overview'); overview.value = d; if (d.prompt_type) persona.value = d.prompt_type } catch (e) { ElMessage.error(String(e)) } }
async function loadStaff() { try { staffList.value = (await apiFetch<{ items: StaffItem[] }>('/v1/admin/staff')).items ?? [] } catch (e) { ElMessage.error(String(e)) } }
async function loadBindings() { try { bindings.value = (await apiFetch<{ items: BindingItem[] }>('/v1/admin/bindings')).items ?? [] } catch (e) { ElMessage.error(String(e)) } }
async function addStaff() {
  if (!newStaff.login_name.trim() || newStaff.password.length < 6) { ElMessage.warning('账号至少 2 位，密码至少 6 位'); return }
  try {
    await apiFetch('/v1/admin/staff', { method: 'POST', body: JSON.stringify(newStaff) })
    ElMessage.success('员工已新增')
    newStaff.login_name = ''; newStaff.password = ''
    await loadStaff()
  } catch (e) { ElMessage.error(String(e)) }
}
async function removeStaff(name: string) {
  try { await apiFetch('/v1/admin/staff/remove', { method: 'POST', body: JSON.stringify({ login_name: name }) }); ElMessage.success('已删除 ' + name); await loadStaff() }
  catch (e) { ElMessage.error(String(e)) }
}
async function unbindSender(id: string) {
  try { await apiFetch('/v1/admin/bindings/unbind', { method: 'POST', body: JSON.stringify({ sender_id: id }) }); ElMessage.success('已解绑 ' + id); await loadBindings() }
  catch (e) { ElMessage.error(String(e)) }
}
function go(v: 'overview' | 'reception' | 'staff' | 'bindings' | 'storage') {
  activeView.value = v
  if (v === 'overview') void loadOverview()
  if (v === 'staff') void loadStaff()
  if (v === 'bindings') { void loadBindings(); void loadStaff(); void loadWxAccounts() }
  if (v === 'storage') { void loadOverview(); void loadStorageDetail() }
}

// ── 微信多开账号管理 ──
interface WxAccount { account: string; status: string }
const wxAccounts = shallowRef<WxAccount[]>([])
const newWxAccount = shallowRef('')
const qrState = reactive<{ account: string; url: string | null; connected: boolean }>({ account: '', url: null, connected: false })
let qrTimer: ReturnType<typeof setInterval> | undefined

async function loadWxAccounts() {
  try { wxAccounts.value = (await apiFetch<{ items: WxAccount[] }>('/v1/admin/wechat/accounts')).items ?? [] }
  catch (e) { ElMessage.error(String(e)) }
}
async function addWxAccount() {
  const acc = newWxAccount.value.trim()
  if (!/^[a-zA-Z0-9_-]{2,40}$/.test(acc)) { ElMessage.warning("账号名 2-40 位，仅字母数字下划线"); return }
  qrState.account = acc; qrState.url = null; qrState.connected = false
  ElMessage.info("正在唤起 OpenClaw 扫码…")
  try {
    await apiFetch("/v1/admin/wechat/accounts/add", { method: "POST", body: JSON.stringify({ account: acc }) })
  } catch (e) { ElMessage.error(String(e)); return }
  if (qrTimer !== undefined) clearInterval(qrTimer)
  let tries = 0
  qrTimer = setInterval(async () => {
    tries += 1
    try {
      const r = await apiFetch<{ qr_url: string | null; connected: boolean }>("/v1/admin/wechat/accounts/login-log?account=" + encodeURIComponent(acc))
      if (r.qr_url !== null) qrState.url = r.qr_url
      if (r.connected) {
        qrState.connected = true
        if (qrTimer !== undefined) clearInterval(qrTimer)
        ElMessage.success("微信已连接：" + acc)
        await loadWxAccounts()
      } else if (tries > 20 && qrState.url === null) {
        if (qrTimer !== undefined) clearInterval(qrTimer)
        ElMessage.warning("二维码生成超时，请确认服务器 OpenClaw 正常运行")
      }
    } catch { /* 轮询失败忽略 */ }
  }, 1500)
}
async function logoutWx(account: string) {
  try { await apiFetch('/v1/admin/wechat/accounts/logout', { method: 'POST', body: JSON.stringify({ account }) }); ElMessage.success('已登出 ' + account); await loadWxAccounts() }
  catch (e) { ElMessage.error(String(e)) }
}


// ── 存储明细 ──
interface StorageTable { name: string; count: number; columns: string[]; rows: string[][] }
const storageTables = shallowRef<StorageTable[]>([])
async function loadStorageDetail() {
  try { storageTables.value = (await apiFetch<{ tables: StorageTable[] }>("/v1/admin/storage/detail")).tables ?? [] }
  catch (e) { ElMessage.error(String(e)) }
}


// ── 生成微信绑定二维码 ──
const bindForm = reactive({ login_name: "diannaoxy", label: "店员" })
const bindCode = reactive<{ url: string; code: string }>({ url: "", code: "" })
async function genBindCode() {
  try {
    const r = await apiFetch<{ code: string; qr_data_url: string }>("/v1/setup/code", {
      method: "POST",
      body: JSON.stringify({
        scene: "baby",
        label: bindForm.label || bindForm.login_name,
        login_name: bindForm.login_name,
      }),
    })
    bindCode.code = r.code
    bindCode.url = r.qr_data_url
    ElMessage.success("绑定码已生成：" + r.code)
  } catch (e) { ElMessage.error("生成失败：" + (e instanceof Error ? e.message : String(e))) }
}


// ── 设置微信归属 ──
const editDlg = reactive({ visible: false, sender: "", login_name: "staff-a", label: "" })
function editBinding(b: { sender_id: string; login_name: string; label: string }) {
  editDlg.visible = true
  editDlg.sender = b.sender_id
  editDlg.login_name = b.login_name
  editDlg.label = b.label
}
async function saveEditBinding() {
  try {
    await apiFetch("/v1/admin/bindings/update", {
      method: "POST",
      body: JSON.stringify({ sender_id: editDlg.sender, login_name: editDlg.login_name, label: editDlg.label }),
    })
    editDlg.visible = false
    ElMessage.success("归属已保存")
    await loadBindings()
  } catch (e) { ElMessage.error(String(e)) }
}


// ── 唤起 OpenClaw 扫码并展示它生成的二维码 ──
async function startWxLogin() {
  qrState.loading = true; qrState.url = null; qrState.connected = false; qrState.expiresIn = 0; qrState.expired = false
  try {
    const r = await apiFetch<{ account: string }>("/v1/admin/wechat/accounts/add", { method: "POST", body: JSON.stringify({}) })
    qrState.account = r.account
    if (qrTimer !== undefined) clearInterval(qrTimer)
    let tries = 0
    qrTimer = setInterval(async () => {
      tries += 1
      try {
        const l = await apiFetch<{ qr_url: string | null; connected: boolean; expires_in: number }>("/v1/admin/wechat/accounts/login-log?account=" + encodeURIComponent(r.account))
        if (l.qr_url !== null) { qrState.url = l.qr_url; qrState.loading = false }
        qrState.expiresIn = l.expires_in ?? 0
        qrState.expired = l.qr_url !== null && !l.connected && (l.expires_in ?? 0) <= 0
        if (l.connected) {
          qrState.connected = true
          if (qrTimer !== undefined) clearInterval(qrTimer)
          ElMessage.success("微信已连接")
          await loadWxAccounts()
        } else if (tries > 20 && qrState.url === null) {
          if (qrTimer !== undefined) clearInterval(qrTimer)
          qrState.loading = false
          ElMessage.warning("二维码生成超时，请检查服务器 OpenClaw")
        }
      } catch { /* 忽略轮询错误 */ }
    }, 1500)
  } catch (e) { qrState.loading = false; ElMessage.error(String(e)) }
}


// ── 微信账号状态文案 ──
function statusText(status: string): string {
  if (/enabled/.test(status)) return "已连接";
  if (/configured/.test(status)) return "已配置";
  if (/installed/.test(status)) return "已安装";
  return status;
}


// ── 普通用户自助注册（人设注册后不可更改） ──
const showRegister = shallowRef(false)
const regLoading = shallowRef(false)
const regForm = reactive({ login_name: "", password: "", confirm: "", prompt_type: "baby" as "baby" | "apparel" | "fraud" })
function openRegister() {
  showRegister.value = true
  regForm.login_name = ""; regForm.password = ""; regForm.confirm = ""; regForm.prompt_type = "baby"
}
async function doRegister() {
  const name = regForm.login_name.trim()
  if (!/^[a-zA-Z0-9_-]{2,20}$/.test(name)) { ElMessage.warning("账号 2-20 位，仅字母数字下划线"); return }
  if (regForm.password.length < 6) { ElMessage.warning("密码至少 6 位"); return }
  if (regForm.password !== regForm.confirm) { ElMessage.warning("两次密码不一致"); return }
  regLoading.value = true
  try {
    const { role: r } = await apiRegister(name, regForm.password, regForm.prompt_type)
    role.value = r
    remoteMode.value = true
    showRegister.value = false
    ElMessage.success("注册成功，人设已锁定")
    go("overview")
  } catch (e) {
    ElMessage.error("注册失败：" + (e instanceof Error ? e.message : String(e)))
  } finally { regLoading.value = false }
}

</script>

<template>
  <div v-if="!role" class="login-mask">
    <div class="login-modal">
      <div class="login-head"><span class="brand-logo" aria-hidden="true"><svg viewBox="0 0 31 24" width="26" height="20"><rect x="0" y="4" width="20" height="7" rx="3.5" fill="currentColor" transform="rotate(-35 10 7.5)"/><rect x="12" y="14" width="20" height="7" rx="3.5" fill="currentColor" transform="rotate(-35 22 17.5)"/></svg></span><div><b>店脑</b><small>门店管理后台</small></div></div>
      <form @submit.prevent="login">
        <label for="username">账号</label>
        <el-input id="username" v-model="account.username" size="large" placeholder="请输入账号" autocomplete="username" />
        <label for="password">密码</label>
        <el-input id="password" v-model="account.password" size="large" type="password" placeholder="请输入密码" show-password autocomplete="current-password" />
        <el-button type="primary" size="large" native-type="submit" :loading="loading" style="width:100%;margin-top:20px">进入工作台</el-button>
      </form>
      <p class="login-tip">还没有账号？<a href="#" style="color:#2c6660;font-weight:700" @click.prevent="openRegister">注册普通用户</a></p>
      <div class="login-links"><a href="/scenes.html">选择场景</a><span>·</span><a href="/setup.html">配置我的店</a><span>·</span><a href="/">返回首页</a></div>
    </div>
  </div>
  <div v-if="showRegister" class="login-mask">
    <div class="login-modal">
      <div class="login-head"><span class="brand-logo" aria-hidden="true"><svg viewBox="0 0 31 24" width="26" height="20"><rect x="0" y="4" width="20" height="7" rx="3.5" fill="currentColor" transform="rotate(-35 10 7.5)"/><rect x="12" y="14" width="20" height="7" rx="3.5" fill="currentColor" transform="rotate(-35 22 17.5)"/></svg></span><div><b>注册普通用户</b><small>人设选定后不可更改</small></div></div>
      <form @submit.prevent="doRegister">
        <label for="regName">账号</label>
        <el-input id="regName" v-model="regForm.login_name" size="large" placeholder="2-20 位字母数字下划线" />
        <label for="regPass">密码</label>
        <el-input id="regPass" v-model="regForm.password" size="large" type="password" placeholder="至少 6 位" show-password />
        <label for="regPass2">确认密码</label>
        <el-input id="regPass2" v-model="regForm.confirm" size="large" type="password" placeholder="再输入一次" show-password />
        <label for="regPersona">选择人设（只能选一个，注册后不可更改）</label>
        <select id="regPersona" v-model="regForm.prompt_type" class="reg-select">
          <option value="baby">母婴店 · 老客与经验</option>
          <option value="apparel">服装店 · 客户画像</option>
          <option value="fraud">AI 反诈 · 风险提示</option>
        </select>
        <el-button type="primary" size="large" native-type="submit" :loading="regLoading" style="width:100%;margin-top:20px">注册并进入</el-button>
      </form>
      <p class="login-tip"><a href="#" style="color:#2c6660;font-weight:700" @click.prevent="showRegister=false">返回登录</a></p>
    </div>
  </div>
  <div v-if="role" class="app-layout">
    <aside class="sidebar"><div class="brand-mark"><span class="brand-logo" aria-hidden="true"><svg viewBox="0 0 31 24" width="26" height="20"><rect x="0" y="4" width="20" height="7" rx="3.5" fill="currentColor" transform="rotate(-35 10 7.5)"/><rect x="12" y="14" width="20" height="7" rx="3.5" fill="currentColor" transform="rotate(-35 22 17.5)"/></svg></span>店脑<span>·</span></div><div class="sidebar-label">门店管理后台</div><nav aria-label="主导航"><span :class="activeView==='overview'?'nav-active':'nav-disabled'" style="cursor:pointer" @click="go('overview')">概览</span><span v-if="persona !== 'fraud'" :class="activeView==='reception'?'nav-active':'nav-disabled'" style="cursor:pointer" @click="go('reception')">客户接待</span><template v-if="role === 'manager'"><span :class="activeView==='staff'?'nav-active':'nav-disabled'" style="cursor:pointer" @click="go('staff')">员工管理</span><span :class="activeView==='bindings'?'nav-active':'nav-disabled'" style="cursor:pointer" @click="go('bindings')">微信绑定</span><span :class="activeView==='storage'?'nav-active':'nav-disabled'" style="cursor:pointer" @click="go('storage')">数据存储</span></template><a class="nav-disabled" href="/landing.html" style="text-decoration:none;color:#cfe2db;cursor:pointer">产品介绍 <small>↗</small></a><a class="nav-disabled" href="/wechat-demo.html" style="text-decoration:none;color:#cfe2db;cursor:pointer">AI 演示 <small>↗</small></a></nav><div class="sidebar-bottom">{{ remoteMode ? '已连接店脑 API' : 'A 店 · 本地模拟' }}<br /><small>{{ role === 'manager' ? '店长' : '店员' }}账号 · 微信端：店脑 ClawBot</small></div></aside>
    <main class="main"><header class="topbar"><div><span class="breadcrumb">后台 / {{ pageTitle }}</span><h1>{{ pageTitle }}</h1></div><div class="top-actions"><span class="environment">{{ remoteMode ? '● 店脑 API' : '● 模拟数据' }}</span><button class="logout" type="button" @click="logout">退出</button></div></header>
      <div class="admin-body">
        <template v-if="activeView==='overview'">
          <div class="stat-grid"><div v-if="overview?.staff_count !== null && overview?.staff_count !== undefined" class="stat"><span>员工</span><b>{{ overview?.staff_count }}</b></div><div v-if="overview?.binding_count !== null && overview?.binding_count !== undefined" class="stat"><span>微信绑定</span><b>{{ overview?.binding_count }}</b></div><div class="stat"><span>客户画像</span><b>{{ overview?.customer_count ?? '-' }}</b></div><div class="stat"><span>商品</span><b>{{ overview?.product_count ?? '-' }}</b></div><div class="stat"><span>服务草稿</span><b>{{ overview?.draft_count ?? '-' }}</b></div><div class="stat"><span>知识条目</span><b>{{ overview?.knowledge_count ?? '-' }}</b></div></div>
          <div class="admin-card"><h3>快捷操作</h3><div class="quick"><template v-if="role === 'manager'"><button @click="go('staff')">新增员工</button><button @click="go('bindings')">管理微信绑定</button><a href="/setup.html" target="_blank">生成绑定二维码</a></template><button @click="go('reception')">开始接待</button><button @click="loadOverview">刷新数据</button></div></div>
        </template>
        <template v-else-if="activeView==='reception'"><div class="workspace"><SearchPanel :customers="customers" :selected-id="selectedId" :remote="remoteMode" :loading="loading" @search="onSearch" @select="onSelect" @clear="selectedId = null" /><div class="right-column"><template v-if="selected"><CustomerDetail :customer="selected" /><NoteForm @submit="saveNote" /></template><div v-else class="placeholder"><span>↗</span><h2>先从左侧确认客户</h2><p>选择脱敏候选后，这里会显示可追溯的购买历史和服务记录。</p></div></div></div>
        </template>
        <template v-else-if="activeView==='staff'">
          <div class="admin-card"><h3>新增员工</h3><div class="form-row"><input v-model="newStaff.login_name" placeholder="登录账号" /><input v-model="newStaff.password" type="password" placeholder="初始密码（≥6 位）" /><select v-model="newStaff.scene"><option value="baby">母婴店</option><option value="apparel">服装店</option></select><select v-model="newStaff.prompt_type"><option value="baby">提示词：母婴</option><option value="apparel">提示词：服装</option><option value="fraud">提示词：反诈</option></select><button @click="addStaff">新增</button></div></div>
          <div class="admin-card"><h3>员工列表（{{ staffList.length }}）</h3><table class="admin-table"><tr><th>账号</th><th>角色</th><th>门店</th><th>状态</th><th>操作</th></tr><tr v-for="st in staffList" :key="st.login_name"><td>{{ st.login_name }}</td><td>{{ st.role }}</td><td>{{ st.tenant_id && st.tenant_id.includes('tenant-c') ? '服装店' : '母婴店' }}</td><td>{{ st.revoked ? '已撤权' : '正常' }}</td><td><button class="link" @click="removeStaff(st.login_name)">删除</button></td></tr></table></div>
        </template>
        <template v-else-if="activeView==='bindings'">
          <div class="admin-card"><h3>连接微信</h3>
            <div class="form-row"><button @click="startWxLogin">生成二维码</button><button @click="loadWxAccounts">刷新</button></div>
            <div v-if="qrState.url" class="qr-box">
              <img :src="'/v1/admin/qr?data=' + encodeURIComponent(qrState.url)" alt="OpenClaw 登录二维码" :class="{ 'qr-black': qrState.connected, 'qr-expired': qrState.expired }" />
              <p v-if="qrState.connected">✅ 已绑定，二维码已失效</p>
              <p v-else-if="qrState.expired">二维码已过期</p>
              <p v-else>用微信扫码，剩余 <b>{{ qrState.expiresIn }}</b> 秒</p>
              <button v-if="qrState.expired" class="link" @click="startWxLogin">重新生成</button>
            </div>
            <p v-else-if="qrState.loading" class="admin-tip">正在唤起 OpenClaw 生成二维码…</p>
            <p v-if="wxAccounts.length === 0" class="admin-tip">还没有连接的微信账号，点上方「生成二维码」用手机扫码接入。</p><table v-else class="admin-table" style="margin-top:16px"><tr><th>已连接的微信账号</th><th>状态</th></tr><tr v-for="w in wxAccounts" :key="w.account"><td>{{ w.account }}</td><td>{{ statusText(w.status) }}</td></tr></table>
          </div>
          <div class="admin-card"><h3>已绑定的微信账户（{{ bindings.length }}）</h3>
            <table class="admin-table"><tr><th>微信 sender</th><th>店脑账号</th><th>说明</th><th>操作</th></tr><tr v-for="b in bindings" :key="b.sender_id"><td>{{ b.sender_id }}</td><td>{{ b.login_name }}</td><td>{{ b.label }}</td><td><button class="link" @click="editBinding(b)">设置归属</button><button class="link" @click="unbindSender(b.sender_id)">解绑</button></td></tr></table>
            <div class="quick" style="margin-top:16px"><button @click="loadBindings">刷新列表</button></div>
          </div>
        </template>
        <template v-else-if="activeView==='storage'">
          <div class="admin-card"><h3>数据存储概览</h3><div class="kv"><span>引擎</span><b>SQLite</b></div><div class="kv"><span>快照</span><b>{{ overview?.storage?.exists ? '已落盘 · ' + overview.storage.updated_at : '尚未生成' }}</b></div><div class="kv"><span>大小</span><b>{{ overview?.storage?.bytes ?? 0 }} 字节</b></div><div class="quick" style="margin-top:16px"><button @click="loadStorageDetail(); loadOverview()">刷新</button></div></div>
          <div v-for="t in storageTables" :key="t.name" class="admin-card"><h3>{{ t.name }} <small style="color:#7a8a86;font-weight:400">共 {{ t.count }} 条</small></h3><table class="admin-table"><tr><th v-for="c in t.columns" :key="c">{{ c }}</th></tr><tr v-for="(row, i) in t.rows" :key="i"><td v-for="(cell, j) in row" :key="j">{{ cell }}</td></tr></table><p v-if="t.rows.length === 0" class="admin-tip">暂无数据</p></div>
        </template>
      </div>
    </main>
  </div>
</template>
