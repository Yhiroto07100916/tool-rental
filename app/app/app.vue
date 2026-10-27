<template>
  <v-app>
    <template v-if="route.path === '/login' || authReady">
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </template>

    <div
      v-else
      class="d-flex justify-center align-center"
      style="min-height: 100vh"
    >
      <v-progress-circular
        indeterminate
        color="primary"
      />
    </div>
  </v-app>
</template>

<script setup lang="ts">
const route = useRoute()
const auth = useAuth()

const authReady = ref(false)

onMounted(() => {
  auth.initialize()
  authReady.value = true
})
</script>
