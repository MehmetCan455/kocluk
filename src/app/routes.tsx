import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { BookDetailPage } from '@/features/books/BookDetailPage';
import { BooksPage } from '@/features/books/BooksPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { VerifyEmailPage } from '@/features/auth/VerifyEmailPage';
import { Onboarding } from '@/features/onboarding/Onboarding';
import { PhotoDetail } from '@/features/photos/PhotoDetail';
import { PhotosPage } from '@/features/photos/PhotosPage';
import { PracticeSessionPage } from '@/features/practice/PracticeSessionPage';
import { PracticeWizard } from '@/features/practice/PracticeWizard';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { SubjectPage } from '@/features/subjects/SubjectPage';
import { SubjectsPage } from '@/features/subjects/SubjectsPage';
import { PagePlaceholder } from './PagePlaceholder';
import { useAppSettings } from './SettingsProvider';

/**
 * Chart.js, TipTap and JSZip are only needed on a few routes. Lazy imports keep
 * them out of the initial shell bundle, which matters on a phone connection.
 */
const DashboardPage = lazy(() =>
  import('@/features/dashboard/DashboardPage').then((module) => ({
    default: module.DashboardPage,
  })),
);
const ExamsPage = lazy(() =>
  import('@/features/exams/ExamsPage').then((module) => ({ default: module.ExamsPage })),
);
const ExamFormPage = lazy(() =>
  import('@/features/exams/ExamFormPage').then((module) => ({ default: module.ExamFormPage })),
);
const ExamDetailPage = lazy(() =>
  import('@/features/exams/ExamDetailPage').then((module) => ({
    default: module.ExamDetailPage,
  })),
);
const TopicPage = lazy(() =>
  import('@/features/topics/TopicPage').then((module) => ({ default: module.TopicPage })),
);
const SchedulePage = lazy(() =>
  import('@/features/schedule/SchedulePage').then((module) => ({
    default: module.SchedulePage,
  })),
);

function AppLoading() {
  return (
    <div role="status" className="py-16 text-center text-sm text-muted">
      Yükleniyor…
    </div>
  );
}

/** Screens only a signed-out visitor may see. */
export const AUTH_ONLY_PATHS: readonly string[] = ['/giris', '/kayit', '/sifremi-unuttum'];

/** Screens reached from an e-mail link; usable with or without a session. */
export const PUBLIC_AUTH_PATHS: readonly string[] = ['/sifre-sifirla', '/eposta-dogrula'];

/**
 * The account routes. They are rendered outside `SettingsProvider` because no
 * user database is open while the visitor is signed out.
 */
export function AuthRoutes() {
  return (
    <Routes>
      <Route path="/giris" element={<LoginPage />} />
      <Route path="/kayit" element={<RegisterPage />} />
      <Route path="/sifremi-unuttum" element={<ForgotPasswordPage />} />
      <Route path="/sifre-sifirla" element={<ResetPasswordPage />} />
      <Route path="/eposta-dogrula" element={<VerifyEmailPage />} />
      <Route path="*" element={<Navigate to="/giris" replace />} />
    </Routes>
  );
}

export function AppRoutes() {
  const { settings, loading } = useAppSettings();
  const location = useLocation();

  if (loading) {
    return <AppLoading />;
  }

  if (!settings.onboardingDone && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <Suspense fallback={<AppLoading />}>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/" element={<DashboardPage />} />

        <Route path="/tyt" element={<SubjectsPage exam="TYT" />} />
        <Route path="/tyt/:subjectId" element={<SubjectPage exam="TYT" />} />
        <Route path="/tyt/:subjectId/:topicId" element={<TopicPage exam="TYT" />} />

        <Route path="/ayt" element={<SubjectsPage exam="AYT" />} />
        <Route path="/ayt/:subjectId" element={<SubjectPage exam="AYT" />} />
        <Route path="/ayt/:subjectId/:topicId" element={<TopicPage exam="AYT" />} />

        <Route path="/denemeler" element={<ExamsPage />} />
        <Route path="/denemeler/yeni" element={<ExamFormPage />} />
        <Route path="/denemeler/:id/duzenle" element={<ExamFormPage />} />
        <Route path="/denemeler/:id" element={<ExamDetailPage />} />

        <Route path="/yanlislar" element={<PhotosPage />} />
        <Route path="/yanlislar/test" element={<PracticeWizard />} />
        <Route path="/yanlislar/test/:sessionId" element={<PracticeSessionPage />} />
        <Route path="/yanlislar/:photoId" element={<PhotoDetail />} />

        <Route path="/kitaplar" element={<BooksPage />} />
        <Route path="/kitaplar/:id" element={<BookDetailPage />} />

        <Route path="/program" element={<SchedulePage />} />

        <Route path="/ayarlar" element={<SettingsPage />} />

        <Route
          path="*"
          element={
            <PagePlaceholder
              title="Sayfa bulunamadı"
              description="Aradığın sayfa taşınmış ya da hiç var olmamış olabilir."
            />
          }
        />
      </Routes>
    </Suspense>
  );
}
