<script setup lang="ts">
const colorMode = useColorMode();
const toast = useToast();

// Toggle color mode
function toggleColorMode() {
  colorMode.preference = colorMode.value === "dark" ? "light" : "dark";
}

// Demo data for charts
const lineChartData = ref([
  { x: "Jan", y: 40 },
  { x: "Feb", y: 55 },
  { x: "Mar", y: 45 },
  { x: "Apr", y: 70 },
  { x: "May", y: 65 },
  { x: "Jun", y: 80 },
]);

const barChartData = ref([
  { name: "Product A", value: 120 },
  { name: "Product B", value: 85 },
  { name: "Product C", value: 150 },
  { name: "Product D", value: 95 },
]);

const donutChartData = ref([45, 35, 20]);
const donutCategories = {
  Desktop: { name: "Desktop", color: "#3b82f6" },
  Mobile: { name: "Mobile", color: "#ef4444" },
  Tablet: { name: "Tablet", color: "#10b981" },
};

// Form state
const formState = reactive({
  email: "",
  name: "",
  notifications: true,
});

// Modal state
const isModalOpen = ref(false);

// Dropdown items
const dropdownItems = [
  { label: "Profile", icon: "i-lucide-user" },
  { label: "Settings", icon: "i-lucide-settings" },
  { label: "Logout", icon: "i-lucide-log-out" },
];

// Show toast
function showToast() {
  toast.add({
    title: "Success!",
    description: "This is a demo toast notification.",
    color: "success",
  });
}
</script>

<template>
  <div class="space-y-12">
    <!-- Header -->
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold text-gray-900 dark:text-white">Nuxt Supabase Starter</h1>
        <p class="mt-2 text-gray-600 dark:text-gray-400">
          A modern starter template with Nuxt UI and Charts
        </p>
      </div>
      <UButton
        :icon="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
        variant="ghost"
        size="lg"
        @click="toggleColorMode"
      />
    </header>

    <!-- Nuxt UI Components Section -->
    <section>
      <h2 class="mb-6 text-2xl font-semibold text-gray-800 dark:text-gray-200">
        Nuxt UI Components
      </h2>

      <div class="grid gap-8 md:grid-cols-2">
        <!-- Buttons -->
        <UCard>
          <template #header>
            <h3 class="font-medium">Buttons</h3>
          </template>
          <div class="flex flex-wrap gap-3">
            <UButton>Primary</UButton>
            <UButton color="secondary">Secondary</UButton>
            <UButton color="success">Success</UButton>
            <UButton color="warning">Warning</UButton>
            <UButton color="error">Error</UButton>
            <UButton variant="outline">Outline</UButton>
            <UButton variant="ghost">Ghost</UButton>
            <UButton icon="i-lucide-plus">With Icon</UButton>
          </div>
        </UCard>

        <!-- Form Elements -->
        <UCard>
          <template #header>
            <h3 class="font-medium">Form Elements</h3>
          </template>
          <div class="space-y-4">
            <UFormField label="Name">
              <UInput v-model="formState.name" placeholder="Enter your name" />
            </UFormField>
            <UFormField label="Email">
              <UInput v-model="formState.email" type="email" placeholder="you@example.com" />
            </UFormField>
            <UCheckbox v-model="formState.notifications" label="Enable notifications" />
          </div>
        </UCard>

        <!-- Badges & Alerts -->
        <UCard>
          <template #header>
            <h3 class="font-medium">Badges</h3>
          </template>
          <div class="flex flex-wrap gap-3">
            <UBadge>Default</UBadge>
            <UBadge color="success">Success</UBadge>
            <UBadge color="warning">Warning</UBadge>
            <UBadge color="error">Error</UBadge>
            <UBadge variant="outline">Outline</UBadge>
            <UBadge variant="subtle">Subtle</UBadge>
          </div>
        </UCard>

        <!-- Interactive Components -->
        <UCard>
          <template #header>
            <h3 class="font-medium">Interactive</h3>
          </template>
          <div class="flex flex-wrap items-center gap-3">
            <UButton @click="showToast"> Show Toast </UButton>
            <UButton variant="outline" @click="isModalOpen = true"> Open Modal </UButton>
            <UDropdownMenu :items="dropdownItems">
              <UButton variant="ghost" trailing-icon="i-lucide-chevron-down"> Dropdown </UButton>
            </UDropdownMenu>
          </div>
        </UCard>
      </div>
    </section>

    <!-- Nuxt Charts Section -->
    <section>
      <h2 class="mb-6 text-2xl font-semibold text-gray-800 dark:text-gray-200">
        Nuxt Charts (Unovis)
      </h2>

      <div class="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        <!-- Line Chart -->
        <UCard>
          <template #header>
            <h3 class="font-medium">Line Chart</h3>
          </template>
          <div class="h-48">
            <LineChart
              :data="lineChartData"
              :x="(d: { x: string }) => d.x"
              :y="(d: { y: number }) => d.y"
            />
          </div>
        </UCard>

        <!-- Bar Chart -->
        <UCard>
          <template #header>
            <h3 class="font-medium">Bar Chart</h3>
          </template>
          <div class="h-48">
            <BarChart
              :data="barChartData"
              :x="(_d: unknown, i: number) => i"
              :y="(d: { value: number }) => d.value"
            />
          </div>
        </UCard>

        <!-- Donut Chart -->
        <UCard>
          <template #header>
            <h3 class="font-medium">Donut Chart</h3>
          </template>
          <div class="h-48">
            <DonutChart
              :data="donutChartData"
              :categories="donutCategories"
              :height="180"
              :radius="70"
            />
          </div>
        </UCard>
      </div>
    </section>

    <!-- Features Section -->
    <section>
      <h2 class="mb-6 text-2xl font-semibold text-gray-800 dark:text-gray-200">
        Included Features
      </h2>

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <UCard>
          <div class="flex items-center gap-3">
            <div class="rounded-lg bg-primary-100 p-2 dark:bg-primary-900">
              <UIcon
                name="i-lucide-layout-dashboard"
                class="size-5 text-primary-600 dark:text-primary-400"
              />
            </div>
            <div>
              <h3 class="font-medium">Nuxt UI</h3>
              <p class="text-sm text-gray-500">Beautiful components</p>
            </div>
          </div>
        </UCard>

        <UCard>
          <div class="flex items-center gap-3">
            <div class="rounded-lg bg-green-100 p-2 dark:bg-green-900">
              <UIcon name="i-lucide-database" class="size-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h3 class="font-medium">Supabase</h3>
              <p class="text-sm text-gray-500">Backend & Auth</p>
            </div>
          </div>
        </UCard>

        <UCard>
          <div class="flex items-center gap-3">
            <div class="rounded-lg bg-purple-100 p-2 dark:bg-purple-900">
              <UIcon
                name="i-lucide-bar-chart-3"
                class="size-5 text-purple-600 dark:text-purple-400"
              />
            </div>
            <div>
              <h3 class="font-medium">Charts</h3>
              <p class="text-sm text-gray-500">Data visualization</p>
            </div>
          </div>
        </UCard>

        <UCard>
          <div class="flex items-center gap-3">
            <div class="rounded-lg bg-orange-100 p-2 dark:bg-orange-900">
              <UIcon
                name="i-lucide-shield-check"
                class="size-5 text-orange-600 dark:text-orange-400"
              />
            </div>
            <div>
              <h3 class="font-medium">TypeScript</h3>
              <p class="text-sm text-gray-500">Type safety</p>
            </div>
          </div>
        </UCard>
      </div>
    </section>

    <!-- Modal -->
    <UModal v-model:open="isModalOpen">
      <template #header>
        <h3 class="text-lg font-semibold">Modal Demo</h3>
      </template>
      <template #body>
        <p class="text-gray-600 dark:text-gray-400">
          This is a demo modal from Nuxt UI. You can use modals to display important information or
          gather user input.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-3">
          <UButton variant="ghost" @click="isModalOpen = false"> Cancel </UButton>
          <UButton @click="isModalOpen = false"> Confirm </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
