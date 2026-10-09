// Served from localhost -> local Supabase stack; anywhere else -> the live project.
(() => {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  window.CFG = {
    url: local ? 'http://127.0.0.1:56321' : 'https://ytaunplmhgcfdmvootke.supabase.co',
    key: local ? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH' : 'sb_publishable_o9hDZ4qDjz8044pg1Z1L0A_9WmAVnAT',
  };
})();
