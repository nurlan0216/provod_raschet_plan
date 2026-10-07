// Копирование и скачивание сметы. ctx нужен только для toast.

export async function copyText(ctx, t) {
  try {
    await navigator.clipboard.writeText(t);
    ctx.toast('Смета скопирована. Вставьте её в Excel (Ctrl+V).');
  } catch {
    const a = document.createElement('textarea');
    a.value = t;
    document.body.appendChild(a);
    a.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      /* нет доступа */
    }
    a.remove();
    ctx.toast(ok ? 'Смета скопирована. Вставьте её в Excel.' : 'Не удалось скопировать. Попробуйте «Скачать CSV».');
  }
}

export function downloadCsv(ctx, text) {
  try {
    const a = document.createElement('a');
    const u = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.href = u;
    a.download = 'smeta.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
    ctx.toast('Файл smeta.csv скачивается. Если он не появился, нажмите «Копировать для Excel».');
  } catch {
    ctx.toast('Скачивание здесь не работает. Нажмите «Копировать для Excel».');
  }
}
