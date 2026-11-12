<script setup lang="ts">
import { shallowRef } from 'vue'
const emit = defineEmits<{ submit: [text: string] }>()
const text = shallowRef('')
function submit() {
  const value = text.value.trim()
  if (!value) return
  emit('submit', value)
  text.value = ''
}
</script>

<template>
  <section class="note-form" aria-labelledby="note-heading">
    <div class="section-kicker">03 / 写记录</div>
    <h2 id="note-heading">把这次接待留下来</h2>
    <p class="muted">只记录本次确认的内容。过敏、健康等安全信息请交人工复核。</p>
    <form @submit.prevent="submit">
      <el-input v-model="text" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="例如：顾客今天询问无香型面霜，已建议先核对成分。" aria-label="服务记录内容" />
      <div class="form-actions"><span>提交后立即显示在本地模拟记录中</span><el-button type="primary" native-type="submit" :disabled="!text.trim()">保存模拟记录</el-button></div>
    </form>
  </section>
</template>
