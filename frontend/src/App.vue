<script setup>
import { computed, onMounted, ref } from 'vue'

const loading = ref(true)
const error = ref('')
const groupedAgents = ref({})

const sortedAgents = computed(() => Object.entries(groupedAgents.value))

async function loadSessions() {
  loading.value = true
  error.value = ''

  try {
    const response = await fetch('/api/sessions')
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`)
    }

    const payload = await response.json()
    groupedAgents.value = payload.agents || {}
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Unknown error'
    groupedAgents.value = {}
  } finally {
    loading.value = false
  }
}

onMounted(loadSessions)
</script>

<template>
  <main class="page">
    <header class="header">
      <h1>Session Manager</h1>
      <button @click="loadSessions">刷新</button>
    </header>

    <p v-if="loading" class="info">加载中...</p>
    <p v-else-if="error" class="error">加载失败：{{ error }}</p>
    <p v-else-if="sortedAgents.length === 0" class="info">
      未发现会话文件，请检查 ~/.codex 和 ~/.claude。
    </p>

    <section v-else class="grid">
      <article v-for="[agent, sessions] in sortedAgents" :key="agent" class="column">
        <h2>{{ agent }}</h2>

        <div v-for="session in sessions" :key="`${session.path}-${session.session_id}`" class="card">
          <h3>{{ session.title }}</h3>
          <p><strong>ID:</strong> {{ session.session_id }}</p>
          <p><strong>来源:</strong> {{ session.source }}</p>
          <p><strong>更新时间:</strong> {{ session.updated_at }}</p>
          <p class="path"><strong>路径:</strong> {{ session.path }}</p>
        </div>
      </article>
    </section>
  </main>
</template>
