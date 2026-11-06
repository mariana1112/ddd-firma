import type { Client, Job, Site } from '../data/types';
import { formatTerm, formatTime } from '../lib/dates';
import { joinAddress, STATUS_TONES, STATUSES } from '../lib/labels';
import { Badge, Row } from '../ui/kit';

export function jobPlace(client: Client | undefined, site: Site | undefined): string {
  if (site) return joinAddress(site.street, '', site.city) || site.name;
  return client ? joinAddress(client.street, '', client.city) : '';
}

export function JobRow(props: { job: Job; client?: Client; site?: Site; timeOnly?: boolean; overdue?: boolean }) {
  const { job, client, site } = props;
  const term = job.start && props.timeOnly ? formatTime(job.start) : formatTerm(job.start);
  return (
    <Row
      to={`/zlecenia/${job.id}`}
      title={client ? client.name : job.title}
      sub={[client ? job.title : null, jobPlace(client, site)].filter(Boolean).join(' · ')}
      meta={`${term} · ${job.number}`}
      trailing={
        props.overdue ? <Badge tone="danger">Zaległe</Badge> : <Badge tone={STATUS_TONES[job.status]}>{STATUSES[job.status]}</Badge>
      }
    />
  );
}
