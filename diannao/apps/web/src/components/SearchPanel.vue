<script setup lang="ts">
// 拼装日接线 patch（INTEGRATION PATCH）—— 待罗（C）复核
// 改动：新增 remote/loading prop 与 search 事件。remote=true 时点查找交给父组件调 API，
//       候选直接用 props.customers（父组件已放 resolve 结果）；remote=false 保持原本地过滤。
import { computed, shallowRef } from 'vue'
import type { Customer } from '../demo-data'

const props = defineProps<{ customers: Customer[]; selectedId: string | null; remote?: boolean; loading?: boolean }>()
const emit = defineEmits<{ select: [id: string]; clear: []; search: [query: string] }>()
const query = shallowRef('')
const searched = shallowRef(false)
const candidates = computed(() => {
  if (props.remote) return props.customers          // 远程模式：父组件已按查询返回候选
  const q = query.value.trim().toLowerCase()
  if (!searched.value || !q) return []
  return props.customers.filter(c => c.name.toLowerCase().includes(q) || c.phoneSuffix.includes(q))
})

function search() {
  emit('clear')
  searched.value = true
  if (props.remote) emit('search', query.value)
}
function onQueryInput() { searched.value = false; emit('clear') }
</script>

<template>
  <section class="search-panel" aria-labelledby="search-heading">
    <div class="section-kicker">01 / 认人</div>
    <h2 id="search-heading">先找到对的人</h2>
    <p class="muted">输入姓名或手机尾号。候选只显示脱敏信息，确认后才能查看档案。</p>
    <form class="search-form" @submit.prevent="search">
      <el-input v-model="query" size="large" clearable :placeholder="remote ? '试试 1234（撞号）、8888（唯一）' : '试试 2468、8831 或林女士'" aria-label="姓名或手机尾号" @input="onQueryInput" />
      <el-button type="primary" size="large" native-type="submit" :loading="loading">查找客户</el-button>
    </form>
    <p v-if="searched && candidates.length > 1" class="inline-note">找到 {{ candidates.length }} 位候选，请根据脱敏线索确认身份。</p>
    <p v-if="searched && candidates.length === 0" class="empty-note">未找到匹配客户。可换一个线索重试。</p>
    <div v-if="candidates.length" class="candidate-list" aria-label="匹配候选">
      <button v-for="customer in candidates" :key="customer.id" type="button" class="candidate" :class="{ active: selectedId === customer.id }" @click="emit('select', customer.id)">
        <span class="candidate-avatar">{{ customer.name.slice(0, 1) }}</span>
        <span class="candidate-main"><strong>{{ customer.name }}</strong><small>{{ customer.phoneMasked }}<template v-if="customer.child"> · {{ customer.child }}</template></small></span>
        <span class="candidate-arrow">查看 →</span>
      </button>
    </div>
  </section>
</template>
