'use client';

import React, { useEffect, useRef, useState } from 'react';
import ImageOutlined from '@mui/icons-material/ImageOutlined';
import FileUploadOutlined from '@mui/icons-material/FileUploadOutlined';
import PhotoLibraryOutlined from '@mui/icons-material/PhotoLibraryOutlined';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import CenterFocusStrongOutlined from '@mui/icons-material/CenterFocusStrongOutlined';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import type { Card, ImageAsset } from '../core/types';

export interface CardImageTarget {
  projectId: string;
  sceneId: string;
  cardId: string;
  cardTitle: string;
}
interface Props {
  target: CardImageTarget;
  card: Card;
  disabled: boolean;
  dirty: boolean;
  onChange: (target: CardImageTarget, image: Card['image']) => void;
  onUploadState: (change: 1 | -1) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onApply: () => void;
}
const MAX_BYTES = 12 * 1024 * 1024;
const sizeLabel = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export default function CardImageEditor({ target, card, disabled, dirty, onChange, onUploadState, onError, onNotice, onApply }: Props) {
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [uploading, setUploading] = useState<{ name: string; title: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const uploadInFlight = useRef(false);
  const libraryRequest = useRef(0);
  const selectedAsset = assets.find(asset => asset.id === card.image?.assetId);
  const blocked = disabled || Boolean(uploading);

  async function refreshAssets() {
    const request = ++libraryRequest.current;
    setLibraryLoading(true);
    setLibraryError('');
    try {
      const response = await fetch('/api/assets', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '素材库读取失败');
      if (mounted.current && request === libraryRequest.current) setAssets(data.assets);
    } catch (error) {
      if (mounted.current && request === libraryRequest.current) setLibraryError((error as Error).message);
    } finally {
      if (mounted.current && request === libraryRequest.current) setLibraryLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refreshAssets();
    return () => { mounted.current = false; libraryRequest.current += 1; };
  }, []);
  useEffect(() => { setDragging(false); setImageFailed(false); if (card.image && !assets.some(asset => asset.id === card.image!.assetId)) void refreshAssets(); }, [card.id, card.image?.assetId]);

  function chooseAsset(asset: ImageAsset) {
    onChange(target, {
      assetId: asset.id,
      layout: card.image?.layout || 'left',
      fit: card.image?.fit || 'cover',
      positionX: 50,
      positionY: 50,
    });
    setLibraryOpen(false);
    onNotice(`已为「${target.cardTitle}」选择图片，保存后应用到预览`);
  }

  async function upload(file?: File) {
    if (!file || blocked || uploadInFlight.current) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      onError('请选择 PNG、JPEG 或静态 WebP 图片。');
      return;
    }
    if (file.size > MAX_BYTES) {
      onError(`图片大小 ${sizeLabel(file.size)}，请使用不超过 12 MB 的原图。`);
      return;
    }
    // The async upload always belongs to this captured target, never the selection at completion.
    const capturedTarget = { ...target };
    const originalImage = card.image ? { ...card.image } : undefined;
    uploadInFlight.current = true;
    setUploading({ name: file.name, title: capturedTarget.cardTitle });
    onUploadState(1);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/assets', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `图片上传失败（${response.status}）`);
      const asset = data.asset as ImageAsset;
      if (mounted.current) {
        libraryRequest.current += 1;
        setLibraryLoading(false);
        setAssets(items => [asset, ...items.filter(item => item.id !== asset.id)]);
        setLibraryOpen(false);
      }
      onChange(capturedTarget, {
        assetId: asset.id,
        layout: originalImage?.layout || 'left',
        fit: originalImage?.fit || 'cover',
        positionX: 50,
        positionY: 50,
      });
    } catch (error) {
      onError(`「${capturedTarget.cardTitle}」上传失败：${(error as Error).message}`);
    } finally {
      uploadInFlight.current = false;
      if (mounted.current) setUploading(null);
      onUploadState(-1);
    }
  }

  function updateImage(change: Partial<NonNullable<Card['image']>>) {
    if (card.image) onChange(target, { ...card.image, ...change });
  }

  return <section className="card-image-editor" aria-label="卡片配图">
    <div className="card-image-heading"><h4><ImageOutlined />卡片配图</h4><span>每张卡片可选一张</span></div>
    <input
      ref={input}
      className="image-file-input"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      aria-label="上传卡片图片"
      disabled={blocked}
      onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void upload(file); }}
    />
    <button
      type="button"
      className={`image-dropzone ${dragging ? 'is-dragging' : ''} ${card.image ? 'has-image' : ''}`}
      aria-label={card.image ? '替换卡片图片，或将图片拖到这里' : '选择本机图片，或将图片拖到这里'}
      disabled={blocked}
      onClick={() => input.current?.click()}
      onDragOver={event => { event.preventDefault(); if (!blocked && Array.from(event.dataTransfer.types).includes('Files')) { event.dataTransfer.dropEffect = 'copy'; setDragging(true); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={event => { event.preventDefault(); setDragging(false); if (blocked) return; const files = [...event.dataTransfer.files]; if (files.length > 1) { onError('每张卡片一次选择一张图片；其他图片可以继续上传到别的卡片。'); return; } void upload(files[0]); }}
    >
      {card.image && selectedAsset && !imageFailed ? <><img src={selectedAsset.url} alt={selectedAsset.name} onError={() => setImageFailed(true)} style={{ objectFit: card.image.fit, objectPosition: `${card.image.positionX}% ${card.image.positionY}%` }} /><span className="replace-image-hint"><FileUploadOutlined />点击替换，或拖入新图片</span></> : <><ImageOutlined /><strong>{card.image ? libraryLoading ? '正在读取图片…' : '图片未能显示，点击重新选择' : '上传一张图片'}</strong><span>{dragging ? '松开后上传到这张卡片' : '点击选择，或把图片拖到这里'}</span></>}
    </button>
    {uploading ? <div className="image-upload-status" role="status"><span className="image-upload-line" /><strong>正在上传：{uploading.name}</strong><span>完成后附到「{uploading.title}」，切换卡片不会改变目标。</span></div> : <div className="image-file-meta">{selectedAsset ? <><span title={selectedAsset.name}>{selectedAsset.name}</span><small>{selectedAsset.width} × {selectedAsset.height} · {sizeLabel(selectedAsset.size)}</small></> : <small>PNG / JPEG / 静态 WebP · 最大 12 MB · 保留原图</small>}</div>}
    <div className="image-actions"><button type="button" disabled={blocked} onClick={() => { setLibraryOpen(!libraryOpen); if (!libraryOpen) void refreshAssets(); }}><PhotoLibraryOutlined />{libraryOpen ? '收起素材库' : '从素材库选择'}</button>{card.image && <button type="button" className="remove-image-button" disabled={blocked} onClick={() => { onChange(target, undefined); onNotice('已移除卡片配图，原图仍保留在素材库；保存后应用'); }}><DeleteOutlineRounded />移除</button>}</div>
    {libraryOpen && <div className="image-library"><div className="image-library-heading"><span>已上传素材 · {assets.length}</span><button type="button" className="icon-button" title="刷新图片素材库" aria-label="刷新图片素材库" disabled={libraryLoading} onClick={() => void refreshAssets()}><RefreshRounded /></button></div>{libraryError ? <p className="image-library-error" role="alert">{libraryError}</p> : libraryLoading && !assets.length ? <p className="image-library-empty">正在读取素材…</p> : !assets.length ? <p className="image-library-empty">素材库还没有图片。先上传一张，即可在其他卡片中复用。</p> : <div className="image-asset-grid">{assets.map(asset => <button type="button" key={asset.id} title={`${asset.name} · ${asset.width} × ${asset.height}`} className={card.image?.assetId === asset.id ? 'selected' : ''} disabled={blocked} onClick={() => chooseAsset(asset)}><img src={asset.url} alt={asset.name} loading="lazy" /><span>{asset.name}</span>{card.image?.assetId === asset.id && <CheckRounded />}</button>)}</div>}</div>}
    {card.image && <div className="image-layout-controls">
      <label className="field"><span className="field-label">图文布局</span><select aria-label="图片布局" value={card.image.layout} disabled={blocked} onChange={event => updateImage({ layout: event.target.value as NonNullable<Card['image']>['layout'] })}><option value="left">左图右文</option><option value="right">右图左文</option><option value="background">背景图</option></select></label>
      <label className="field"><span className="field-label">图片显示</span><select aria-label="图片显示方式" value={card.image.fit} disabled={blocked} onChange={event => updateImage({ fit: event.target.value as NonNullable<Card['image']>['fit'] })}><option value="cover">填满裁切</option><option value="contain">完整显示</option></select></label>
      <div className="image-position-heading"><span>画面位置</span><button type="button" disabled={blocked || (card.image.positionX === 50 && card.image.positionY === 50)} onClick={() => updateImage({ positionX: 50, positionY: 50 })}><CenterFocusStrongOutlined />居中重置</button></div>
      <label className="field image-position"><span className="field-label">水平位置 <b>{card.image.positionX}%</b></span><input aria-label="图片水平位置" disabled={blocked} type="range" min="0" max="100" step="1" value={card.image.positionX} onChange={event => updateImage({ positionX: Number(event.target.value) })} /><span className="range-ends"><span>左侧</span><span>右侧</span></span></label>
      <label className="field image-position"><span className="field-label">垂直位置 <b>{card.image.positionY}%</b></span><input aria-label="图片垂直位置" disabled={blocked} type="range" min="0" max="100" step="1" value={card.image.positionY} onChange={event => updateImage({ positionY: Number(event.target.value) })} /><span className="range-ends"><span>顶部</span><span>底部</span></span></label>
    </div>}
    {(card.image || dirty) && <div className="image-preview-note"><span>{dirty ? '更改尚未保存，视频预览仍显示已保存版本。' : '配图已保存，与卡片一起参与动画和导出。'}</span>{dirty && <button type="button" disabled={blocked} onClick={onApply}>保存并应用到预览</button>}</div>}
  </section>;
}
