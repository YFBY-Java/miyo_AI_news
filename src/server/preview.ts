import fs from 'node:fs/promises';
import path from 'node:path';
import { compileEpisode, estimatePlan } from '../core/project';
import type { Project, ProjectResponse } from '../core/types';
import { createVideoHtml } from '../engine/renderer';
import { ROOT, findPrepared, listJobs, mediaUrl } from './storage';
import { resolveImageSources } from './images';
let font:Promise<string>;
export function fontData(){return font ||= fs.readFile(path.join(ROOT,'public/assets/htmlFont.ttf')).then(b=>'data:font/ttf;base64,'+b.toString('base64'));}
export async function previewState(p:Project){const prepared=await findPrepared(p);const episode=compileEpisode(p,prepared?.plan||estimatePlan(p));return {episode,prepared};}
export async function htmlForProject(p:Project){const {episode}=await previewState(p);return createVideoHtml(episode,{game:p.game,...p.presentation,fontDataUri:await fontData(),imageSources:await resolveImageSources(p)});}
export async function projectResponse(p:Project):Promise<ProjectResponse>{
  const {episode,prepared}=await previewState(p);const jobs=await listJobs(p.id);
  return {project:p,jobs,preview:{url:`/api/projects/${p.id}/preview?v=${p.revision}&audio=${prepared?.job.id||'draft'}`,audioUrl:prepared?mediaUrl(prepared.audio):undefined,duration:episode.duration,ready:!!prepared,stale:!prepared&&jobs.some(j=>j.kind!=='sample'&&j.status==='succeeded'),sceneTimes:episode.scenes.map(s=>({id:s.id,start:s.start,duration:s.duration}))}};
}
