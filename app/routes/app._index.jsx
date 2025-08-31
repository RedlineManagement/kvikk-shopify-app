// app/routes/app._index.jsx - Főoldal
import { useState, useEffect } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, Form, useActionData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  TextField,
  Select,
  Checkbox,
  Banner,
  Spinner,
  DataTable,
  Badge,
  Stack,
  Text,
  Divider
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

// Loader - adatok betöltése
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  
  try {
    // App beállítások lekérése
    const response = await fetch(`${process.env.HOST}/api/settings`, {
      headers: { 'Authorization': `Bearer ${admin.accessToken}` }
    });
    const settings = await response.json();
    
    // Legutóbbi szállítmányok
    const shipments = await getRecentShipments(admin);
    
    return json({ settings, shipments, success: true });
  } catch (error) {
    return json({ error: error.message, success: false });
  }
};

// Action - form feldolgozás
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("_action");
  
  try {
    if (action === "save_settings") {
      const settings = {
        kvikk_api_key: formData.get("kvikk_api_key"),
        default_service: formData.get("default_service"),
        auto_create_shipments: formData.get("auto_create_shipments") === "on",
        sender_name: formData.get("sender_name"),
        sender_address: formData.get("sender_address"),
        sender_city: formData.get("sender_city"),
        sender_postal_code: formData.get("sender_postal_code"),
        sender_phone: formData.get("sender_phone")
      };
      
      await fetch(`${process.env.HOST}/api/settings`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${admin.accessToken}` 
        },
        body: JSON.stringify(settings)
      });
      
      return json({ success: true, message: "Beállítások mentve!" });
    }
    
    if (action === "test_connection") {
      const apiKey = formData.get("kvikk_api_key");
      const testResult = await testKvikkConnection(apiKey);
      return json({ testResult });
    }
    
  } catch (error) {
    return json({ success: false, error: error.message });
  }
};

// Fő komponens
export default function Index() {
  const { settings, shipments } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  
  const [formData, setFormData] = useState({
    kvikk_api_key: settings?.kvikk_api_key || '',
    default_service: settings?.default_service || 'standard',
    auto_create_shipments: settings?.auto_create_shipments || true,
    sender_name: settings?.sender_name || '',
    sender_address: settings?.sender_address || '',
    sender_city: settings?.sender_city || '',
    sender_postal_code: settings?.sender_postal_code || '',
    sender_phone: settings?.sender_phone || ''
  });
  
  const [activeTab, setActiveTab] = useState(0);
  const isLoading = navigation.state === "submitting";

  const tabs = [
    { id: 'settings', content: 'Beállítások' },
    { id: 'shipments', content: 'Szállítmányok' },
    { id: 'rates', content: 'Díjak' },
    { id: 'help', content: 'Súgó' }
  ];

  const serviceOptions = [
    { label: 'Standard', value: 'standard' },
    { label: 'Express', value: 'express' },
    { label: 'Economy', value: 'economy' }
  ];

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <Page
      title="Kvikk Shipping Integration"
      subtitle="Automatizált szállítás kezelés"
      primaryAction={{
        content: "Beállítások mentése",
        onAction: () => document.getElementById('settings-form').submit(),
        loading: isLoading
      }}
    >
      {actionData?.success && (
        <Banner status="success" onDismiss={() => {}}>
          {actionData.message}
        </Banner>
      )}
      
      {actionData?.error && (
        <Banner status="critical" onDismiss={() => {}}>
          Hiba: {actionData.error}
        </Banner>
      )}

      <Layout>
        <Layout.Section>
          {/* Státusz kártyák */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            <Card>
              <div style={{ padding: '1rem' }}>
                <Stack vertical spacing="tight">
                  <Text variant="headingMd">API Kapcsolat</Text>
                  <Badge status={settings?.kvikk_api_key ? 'success' : 'critical'}>
                    {settings?.kvikk_api_key ? 'Konfigurálva' : 'Nincs beállítva'}
                  </Badge>
                </Stack>
              </div>
            </Card>
            
            <Card>
              <div style={{ padding: '1rem' }}>
                <Stack vertical spacing="tight">
                  <Text variant="headingMd">Automatikus szállítmányok</Text>
                  <Badge status={settings?.auto_create_shipments ? 'success' : 'warning'}>
                    {settings?.auto_create_shipments ? 'Bekapcsolva' : 'Kikapcsolva'}
                  </Badge>
                </Stack>
              </div>
            </Card>
            
            <Card>
              <div style={{ padding: '1rem' }}>
                <Stack vertical spacing="tight">
                  <Text variant="headingMd">Mai szállítmányok</Text>
                  <Text variant="headingLg">{shipments?.today || 0}</Text>
                </Stack>
              </div>
            </Card>
          </div>

          {/* Fő tartalom */}
          <Card>
            <div style={{ padding: '1rem' }}>
              {/* Tab navigáció egyszerűsített */}
              <div style={{ borderBottom: '1px solid #e1e3e5', marginBottom: '1rem' }}>
                <Stack>
                  {tabs.map((tab, index) => (
                    <Button
                      key={tab.id}
                      plain
                      pressed={activeTab === index}
                      onAction={() => setActiveTab(index)}
                    >
                      {tab.content}
                    </Button>
                  ))}
                </Stack>
              </div>

              {/* Beállítások tab */}
              {activeTab === 0 && (
                <Form method="post" id="settings-form">
                  <input type="hidden" name="_action" value="save_settings" />
                  
                  <Stack vertical spacing="loose">
                    <Text variant="headingLg">Kvikk API Beállítások</Text>
                    
                    <TextField
                      label="Kvikk API Kulcs"
                      value={formData.kvikk_api_key}
                      onChange={(value) => handleInputChange('kvikk_api_key', value)}
                      name="kvikk_api_key"
                      type="password"
                      helpText="API kulcsod a Kvikk admin felületéről"
                    />
                    
                    <div style={{ display: 'flex', gap: '1rem' }}>
                      <Button 
                        variant="secondary"
                        onAction={() => {
                          const form = new FormData();
                          form.append('_action', 'test_connection');
                          form.append('kvikk_api_key', formData.kvikk_api_key);
                          fetch('/app', { method: 'POST', body: form });
                        }}
                      >
                        Kapcsolat tesztelése
                      </Button>
                    </div>

                    <Divider />

                    <Text variant="headingLg">Szállítási Beállítások</Text>
                    
                    <Select
                      label="Alapértelmezett szolgáltatás"
                      options={serviceOptions}
                      value={formData.default_service}
                      onChange={(value) => handleInputChange('default_service', value)}
                      name="default_service"
                    />
                    
                    <Checkbox
                      label="Automatikus szállítmány létrehozás új rendelésnél"
                      checked={formData.auto_create_shipments}
                      onChange={(checked) => handleInputChange('auto_create_shipments', checked)}
                      name="auto_create_shipments"
                    />

                    <Divider />

                    <Text variant="headingLg">Feladó Adatok</Text>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
                      <TextField
                        label="Cégnév"
                        value={formData.sender_name}
                        onChange={(value) => handleInputChange('sender_name', value)}
                        name="sender_name"
                      />
                      
                      <TextField
                        label="Cím"
                        value={formData.sender_address}
                        onChange={(value) => handleInputChange('sender_address', value)}
                        name="sender_address"
                      />
                      
                      <TextField
                        label="Város"
                        value={formData.sender_city}
                        onChange={(value) => handleInputChange('sender_city', value)}
                        name="sender_city"
                      />
                      
                      <TextField
                        label="Irányítószám"
                        value={formData.sender_postal_code}
                        onChange={(value) => handleInputChange('sender_postal_code', value)}
                        name="sender_postal_code"
                      />
                      
                      <TextField
                        label="Telefon"
                        value={formData.sender_phone}
                        onChange={(value) => handleInputChange('sender_phone', value)}
                        name="sender_phone"
                        type="tel"
                      />
                    </div>
                  </Stack>
                </Form>
              )}

              {/* Szállítmányok tab */}
              {activeTab === 1 && (
                <Stack vertical spacing="loose">
                  <Text variant="headingLg">Legutóbbi Szállítmányok</Text>
                  
                  <DataTable
                    columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                    headings={['Rendelésszám', 'Címzett', 'Szolgáltatás', 'Státusz', 'Nyomkövetés']}
                    rows={shipments?.recent?.map(shipment => [
                      shipment.order_number,
                      shipment.recipient_name,
                      shipment.service_type,
                      <Badge 
                        key={shipment.id}
                        status={getStatusBadgeStatus(shipment.status)}
                      >
                        {shipment.status}
                      </Badge>,
                      shipment.tracking_number
                    ]) || []}
                  />
                </Stack>
              )}

              {/* Díjak tab */}
              {activeTab === 2 && (
                <Stack vertical spacing="loose">
                  <Text variant="headingLg">Szállítási Díjak Tesztelése</Text>
                  <Text>Itt tudsz tesztelni különböző címekre a szállítási díjakat.</Text>
                  {/* Díj tesztelő form */}
                </Stack>
              )}

              {/* Súgó tab */}
              {activeTab === 3 && (
                <Stack vertical spacing="loose">
                  <Text variant="headingLg">Kvikk Integráció Súgó</Text>
                  
                  <Card sectioned>
                    <Stack vertical spacing="tight">
                      <Text variant="headingMd">1. Telepítés és beállítás</Text>
                      <Text>
                        • Szerezz be API kulcsot a Kvikk admin felületéről<br/>
                        • Add meg a feladó adatokat<br/>
                        • Teszteld a kapcsolatot
                      </Text>
                    </Stack>
                  </Card>

                  <Card sectioned>
                    <Stack vertical spacing="tight">
                      <Text variant="headingMd">2. Szállítási díjak</Text>
                      <Text>
                        • A vásárlók automatikusan látják a Kvikk díjakat a checkout-ban<br/>
                        • A díjak valós időben számítódnak a rendelés alapján<br/>
                        • Több szállítási opció közül választhatnak
                      </Text>
                    </Stack>
                  </Card>

                  <Card sectioned>
                    <Stack vertical spacing="tight">
                      <Text variant="headingMd">3. Automatikus szállítmányok</Text>
                      <Text>
                        • Új rendelésnél automatikusan létrehozódik a szállítmány<br/>
                        • A nyomkövetési szám hozzáadódik a rendeléshez<br/>
                        • A vásárló email értesítést kap
                      </Text>
                    </Stack>
                  </Card>

                  <Card sectioned>
                    <Stack vertical spacing="tight">
                      <Text variant="headingMd">4. Támogatás</Text>
                      <Text>
                        Problémák esetén:<br/>
                        • Kvikk támogatás: support@kvikk.hu<br/>
                        • App fejlesztő: your-email@domain.com<br/>
                        • Dokumentáció: support.kvikk.hu
                      </Text>
                    </Stack>
                  </Card>
                </Stack>
              )}
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

// Segédfüggvények
function getStatusBadgeStatus(status) {
  switch (status?.toLowerCase()) {
    case 'delivered': return 'success';
    case 'in_transit': return 'info';
    case 'pending': return 'warning';
    case 'failed': return 'critical';
    default: return 'info';
  }
}

async function getRecentShipments(admin) {
  try {
    // Kvikk API hívás a legutóbbi szállítmányokért
    const response = await fetch('https://api.kvikk.hu/v1/shipments', {
      headers: { 'X-API-KEY': process.env.KVIKK_API_KEY }
    });
    
    if (!response.ok) return { recent: [], today: 0 };
    
    const data = await response.json();
    return {
      recent: data.shipments?.slice(0, 10) || [],
      today: data.shipments?.filter(s => 
        new Date(s.created_at).toDateString() === new Date().toDateString()
      ).length || 0
    };
  } catch (error) {
    return { recent: [], today: 0 };
  }
}

async function testKvikkConnection(apiKey) {
  try {
    const response = await fetch('https://api.kvikk.hu/v1/test', {
      headers: { 'X-API-KEY': apiKey }
    });
    
    return {
      success: response.ok,
      message: response.ok ? 'Kapcsolat sikeres!' : 'API kulcs érvénytelen'
    };
  } catch (error) {
    return {
      success: false,
      message: 'Kapcsolódási hiba: ' + error.message
    };
  }
}