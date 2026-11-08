import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { attachments } from '../data/repo';
import { isSyncConfigured } from '../data/sync/config';
import { loadServer } from '../data/sync/runner';
import type { Attachment } from '../data/types';
import { resizePhoto } from '../lib/images';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Sheet } from '../ui/kit';

/** Zdjęcie z innego urządzenia jest pobierane z serwera przy pierwszym wyświetleniu. */
async function loadPhoto(photo: Attachment): Promise<Blob | null> {
  if (photo.blob || !photo.remotePath || !isSyncConfigured) return photo.blob;
  const [{ ensurePhoto }, server] = await Promise.all([import('../data/sync/engine'), loadServer()]);
  return ensurePhoto(server, photo);
}

function usePhotoUrl(photo: Attachment): { url?: string; missing: boolean } {
  const [url, setUrl] = useState<string>();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let objectUrl: string | undefined;
    let cancelled = false;
    setMissing(false);
    loadPhoto(photo)
      .then((blob) => {
        if (cancelled) return;
        if (!blob) {
          setMissing(true);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // Odczyt z bazy daje za każdym razem nowy obiekt, więc zależność to tożsamość i wersja zdjęcia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id, photo.updatedAt, Boolean(photo.blob)]);
  return { url, missing };
}

function PhotoThumb({ photo, onOpen }: { photo: Attachment; onOpen: () => void }) {
  const { url, missing } = usePhotoUrl(photo);
  return (
    <button type="button" className="photo" onClick={onOpen} aria-label={`Zdjęcie ${photo.name}`}>
      {url && <img src={url} alt="" />}
      {missing && <span className="photo-missing">Zdjęcie na serwerze, brak połączenia</span>}
    </button>
  );
}

function PhotoView({ photo, onDelete }: { photo: Attachment; onDelete?: () => void }) {
  const { url } = usePhotoUrl(photo);
  return (
    <>
      {url && <img className="photo-large" src={url} alt={photo.name} />}
      {onDelete && (
        <button type="button" className="btn btn-danger-quiet btn-block" onClick={onDelete}>
          <Icon name="trash" /> Usuń zdjęcie
        </button>
      )}
    </>
  );
}

/** Zdjęcia zabiegu: dodawanie z aparatu lub galerii, podgląd i usuwanie z cofnięciem. */
export function Photos({ visitId, readOnly = false }: { visitId: string; readOnly?: boolean }) {
  const { run, toast } = useFeedback();
  const photos = useLiveQuery(() => attachments.where('jobId', visitId), [visitId]) ?? [];
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Attachment | null>(null);

  const add = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    await run(async () => {
      for (const file of files) {
        await attachments.create({ jobId: visitId, name: file.name, mime: 'image/jpeg', blob: await resizePhoto(file) });
      }
      toast(files.length === 1 ? 'Dodano zdjęcie' : `Dodano zdjęcia: ${files.length}`);
    });
    setBusy(false);
  };

  const remove = (photo: Attachment) => {
    setOpen(null);
    void run(async () => {
      await attachments.softDelete(photo.id);
      toast('Zdjęcie jest w koszu', { action: { label: 'Cofnij', onClick: () => void run(() => attachments.restore(photo.id)) } });
    });
  };

  if (readOnly && photos.length === 0) return <p className="field-hint">Brak zdjęć</p>;

  return (
    <>
      <div className="photos">
        {photos.map((p) => (
          <PhotoThumb key={p.id} photo={p} onOpen={() => setOpen(p)} />
        ))}
        {!readOnly && (
        <label className="photo photo-add">
          <Icon name="camera" />
          <span>{busy ? 'Zapisuję…' : 'Dodaj'}</span>
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={busy}
            onChange={(e) => {
              // FileList jest żywa: wyczyszczenie pola opróżniłoby ją przed końcem zapisu.
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              void add(files);
            }}
          />
        </label>
        )}
      </div>
      <Sheet open={Boolean(open)} title="Zdjęcie" onClose={() => setOpen(null)}>
        {open && <PhotoView photo={open} onDelete={readOnly ? undefined : () => remove(open)} />}
      </Sheet>
    </>
  );
}
