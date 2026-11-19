import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Onboarding } from '@/features/onboarding/Onboarding';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { SubjectPage } from '@/features/subjects/SubjectPage';
import { SubjectsPage } from '@/features/subjects/SubjectsPage';
import { TopicPage } from '@/features/topics/TopicPage';
import { PagePlaceholder } from './PagePlaceholder';
import { useAppSettings } from './SettingsProvider';

function AppLoading() {
  return (
    <div role="status" className="py-16 text-center text-sm text-muted">
      Yükleniyor…
    </div>
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
    <Routes>
      <Route path="/onboarding" element={<Onboarding />} />
      <Route
        path="/"
        element={
          <PagePlaceholder
            title="Genel Bakış"
            description="Ana sayfa panosu yakında burada olacak."
          />
        }
      />

      <Route path="/tyt" element={<SubjectsPage exam="TYT" />} />
      <Route path="/tyt/:subjectId" element={<SubjectPage exam="TYT" />} />
      <Route path="/tyt/:subjectId/:topicId" element={<TopicPage exam="TYT" />} />

      <Route path="/ayt" element={<SubjectsPage exam="AYT" />} />
      <Route path="/ayt/:subjectId" element={<SubjectPage exam="AYT" />} />
      <Route path="/ayt/:subjectId/:topicId" element={<TopicPage exam="AYT" />} />

      <Route
        path="/denemeler"
        element={
          <PagePlaceholder
            title="Denemeler"
            description="Deneme kayıtları ve net sonuçları yakında burada olacak."
          />
        }
      />
      <Route
        path="/denemeler/yeni"
        element={
          <PagePlaceholder
            title="Yeni Deneme"
            description="Deneme kayıt formu yakında burada olacak."
          />
        }
      />
      <Route
        path="/denemeler/:id"
        element={
          <PagePlaceholder
            title="Deneme Detayı"
            description="Deneme detayı yakında burada olacak."
          />
        }
      />

      <Route
        path="/yanlislar"
        element={
          <PagePlaceholder
            title="Yanlışlar"
            description="Yanlış fotoğrafları galerisi yakında burada olacak."
          />
        }
      />
      <Route
        path="/yanlislar/test"
        element={
          <PagePlaceholder
            title="Rastgele Test"
            description="Rastgele test sihirbazı yakında burada olacak."
          />
        }
      />
      <Route
        path="/yanlislar/test/:sessionId"
        element={
          <PagePlaceholder
            title="Test Oturumu"
            description="Test oturumu yakında burada olacak."
          />
        }
      />

      <Route
        path="/kitaplar"
        element={
          <PagePlaceholder
            title="Kitaplar"
            description="Kitap listesi yakında burada olacak."
          />
        }
      />
      <Route
        path="/kitaplar/:id"
        element={
          <PagePlaceholder
            title="Kitap Detayı"
            description="Kitap detayı yakında burada olacak."
          />
        }
      />

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
  );
}
