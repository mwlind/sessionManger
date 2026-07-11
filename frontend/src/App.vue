<script setup>
import { computed, onMounted, ref } from 'vue'

const loading = ref(true)
const error = ref('')
const groupedAgents = ref({})
const selectedSession = ref(null)
const viewerLoading = ref(false)
const viewerError = ref('')
const viewerContent = ref('')
const createDefaultViewerMeta = () => ({ offset: 0, nextOffset: 0, prevOffset: 0, hasMore: false, totalBytes: 0, readBytes: 0 })
const viewerMeta = ref(createDefaultViewerMeta())
const chunkSizeBytes = 65536

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

async function loadSessionChunk(offset = 0) {
  if (!selectedSession.value) return
  viewerLoading.value = true
  viewerError.value = ''

  try {
    const params = new URLSearchParams({
      path: selectedSession.value.path,
      offset: String(Math.max(0, offset)),
      chunk_bytes: String(chunkSizeBytes),
    })
    const response = await fetch(`/api/session-content?${params.toString()}`)
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`)
    }

    const payload = await response.json()
    viewerContent.value = payload.content || ''
    viewerMeta.value = {
      offset: payload.offset ?? 0,
      nextOffset: payload.next_offset ?? 0,
      prevOffset: payload.prev_offset ?? 0,
      hasMore: payload.has_more ?? false,
      totalBytes: payload.total_bytes ?? 0,
      readBytes: payload.read_bytes ?? 0,
    }
  } catch (err) {
    viewerError.value = err instanceof Error ? err.message : 'Unknown error'
    viewerContent.value = ''
    viewerMeta.value = createDefaultViewerMeta()
  } finally {
    viewerLoading.value = false
  }
}

function openSession(session) {
  selectedSession.value = session
  loadSessionChunk(0)
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
          <button @click="openSession(session)">查看文本</button>
        </div>
      </article>
    </section>

    <section v-if="selectedSession" class="viewer">
      <h2>文本查看：{{ selectedSession.title }}</h2>
      <p class="path">{{ selectedSession.path }}</p>
      <p class="info">偏移 {{ viewerMeta.offset }}，本次读取 {{ viewerMeta.readBytes }} 字节，总大小 {{ viewerMeta.totalBytes }} 字节</p>
      <p v-if="viewerLoading" class="info">文本加载中...</p>
      <p v-else-if="viewerError" class="error">读取失败：{{ viewerError }}</p>
      <pre v-else class="content" role="region" aria-label="Session file content">{{ viewerContent || '(空文件)' }}</pre>
      <div class="controls">
        <button :disabled="viewerLoading || viewerMeta.offset <= 0" @click="loadSessionChunk(viewerMeta.prevOffset)">上一段</button>
        <button :disabled="viewerLoading || !viewerMeta.hasMore" @click="loadSessionChunk(viewerMeta.nextOffset)">下一段</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.page { padding: 1rem; font-family: system-ui, sans-serif; }
.header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0.75rem; }
.column { border: 1px solid #ddd; border-radius: 8px; padding: 0.75rem; }
.card { border: 1px solid #eee; border-radius: 6px; padding: 0.5rem; margin-bottom: 0.5rem; }
.path { word-break: break-all; color: #555; }
.viewer { margin-top: 1rem; border: 1px solid #ddd; border-radius: 8px; padding: 0.75rem; }
.content { max-height: 420px; overflow: auto; background: #111; color: #e8e8e8; padding: 0.75rem; border-radius: 6px; white-space: pre-wrap; }
.controls { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
.error { color: #b42318; }
.info { color: #344054; }
</style>
