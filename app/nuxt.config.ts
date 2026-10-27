export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',

  devtools: {
    enabled: true,
  },

  modules: [
    'vuetify-nuxt-module',
  ],

  vuetify: {
    moduleOptions: {
      prefixComposables: ['useLayout'],
    },

    vuetifyOptions: {
      theme: {
        defaultTheme: 'light',

        themes: {
          light: {
            colors: {
              primary: '#1565C0',
              secondary: '#455A64',
              success: '#2E7D32',
              warning: '#EF6C00',
              error: '#C62828',
              background: '#F5F7FA',
              surface: '#FFFFFF',
            },
          },
        },
      },

      defaults: {
        VCard: {
          rounded: 'lg',
        },

        VBtn: {
          rounded: 'lg',
        },

        VTextField: {
          variant: 'outlined',
          density: 'comfortable',
        },

        VSelect: {
          variant: 'outlined',
          density: 'comfortable',
        },
      },
    },
  },

  css: [
    '~/assets/styles/main.scss',
  ],

  runtimeConfig: {
    public: {
      apiBaseUrl: 'https://tool-rental-api.hibiya-seiryofes-chief-it.workers.dev',
    },
  },
})
