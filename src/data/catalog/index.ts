import type { CatalogBookSeed } from './types';
import { TYT_TURKCE } from './tyt-turkce';
import { TYT_MATEMATIK } from './tyt-matematik';
import { TYT_GEOMETRI } from './tyt-geometri';
import { TYT_FIZIK } from './tyt-fizik';
import { TYT_KIMYA } from './tyt-kimya';
import { TYT_BIYOLOJI } from './tyt-biyoloji';
import { TYT_TARIH } from './tyt-tarih';
import { TYT_COGRAFYA } from './tyt-cografya';
import { TYT_FELSEFE } from './tyt-felsefe';
import { TYT_DIN_KULTURU } from './tyt-din-kulturu';
import { AYT_MATEMATIK } from './ayt-matematik';
import { AYT_GEOMETRI } from './ayt-geometri';
import { AYT_EDEBIYAT } from './ayt-edebiyat';
import { AYT_FIZIK } from './ayt-fizik';
import { AYT_KIMYA } from './ayt-kimya';
import { AYT_BIYOLOJI } from './ayt-biyoloji';
import { AYT_TARIH_1 } from './ayt-tarih-1';
import { AYT_TARIH_2 } from './ayt-tarih-2';
import { AYT_COGRAFYA_1 } from './ayt-cografya-1';
import { AYT_COGRAFYA_2 } from './ayt-cografya-2';
import { AYT_FELSEFE_GRUBU } from './ayt-felsefe-grubu';
import { AYT_DIN_KULTURU } from './ayt-din-kulturu';

/** Research reports land here; `CATALOG_SEED` appends these after the starter rows. */
export const YENI_KATALOG: readonly CatalogBookSeed[] = [
  ...TYT_TURKCE,
  ...TYT_MATEMATIK,
  ...TYT_GEOMETRI,
  ...TYT_FIZIK,
  ...TYT_KIMYA,
  ...TYT_BIYOLOJI,
  ...TYT_TARIH,
  ...TYT_COGRAFYA,
  ...TYT_FELSEFE,
  ...TYT_DIN_KULTURU,
  ...AYT_MATEMATIK,
  ...AYT_GEOMETRI,
  ...AYT_EDEBIYAT,
  ...AYT_FIZIK,
  ...AYT_KIMYA,
  ...AYT_BIYOLOJI,
  ...AYT_TARIH_1,
  ...AYT_TARIH_2,
  ...AYT_COGRAFYA_1,
  ...AYT_COGRAFYA_2,
  ...AYT_FELSEFE_GRUBU,
  ...AYT_DIN_KULTURU,
];
