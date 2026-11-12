<script setup lang="ts">
import type { Customer } from '../demo-data'
defineProps<{ customer: Customer }>()
</script>

<template>
  <section class="detail" aria-labelledby="detail-heading">
    <div class="section-kicker">02 / 看历史</div>
    <div class="detail-header">
      <div><h2 id="detail-heading">{{ customer.name }}</h2><p class="muted">{{ customer.phoneMasked }} · {{ customer.child }}</p></div>
      <span class="mock-tag">模拟档案</span>
    </div>
    <div class="tags"><span v-for="tag in customer.tags" :key="tag">{{ tag }}</span></div>
    <div class="fact-row"><div class="fact-label">是谁</div><p>{{ customer.name }}，{{ customer.child }}。身份由店员在候选中确认。</p></div>
    <div class="fact-row"><div class="fact-label">以前买过什么</div><div v-if="customer.purchases.length"><p v-for="purchase in customer.purchases" :key="purchase.id"><strong>{{ purchase.item }}</strong> <span class="muted">{{ purchase.date }} · {{ purchase.detail }} · 来源 {{ purchase.id }}</span></p></div><p v-else class="muted">暂无购买记录。</p></div>
    <div class="fact-row"><div class="fact-label">建议做什么</div><p>{{ customer.suggestion }}</p></div>
    <div class="history"><h3>服务记录 <span>{{ customer.notes.length }}</span></h3><p v-if="!customer.notes.length" class="muted">暂无服务记录。</p><article v-for="note in customer.notes" :key="note.id" class="note"><p>{{ note.text }}</p><small>{{ note.date }} · {{ note.author }} · 来源 {{ note.id }}</small></article></div>
  </section>
</template>
