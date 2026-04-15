import { describe, expect, it } from 'vitest'

import {
  analyzeComponentResolution,
  collectTemplateComponentTags,
  findUnresolvedComponentUsages,
} from '../../../scripts/lib/vue-component-resolution.mts'

describe('vue component resolution guard', () => {
  it('collects component tags from template', () => {
    const content = `
<template>
  <div>
    <KnownCard />
    <UnknownWidget />
    <component :is="dynamicComp" />
  </div>
</template>
`
    const tags = collectTemplateComponentTags(content)
    expect(tags).toContain('KnownCard')
    expect(tags).toContain('UnknownWidget')
    expect(tags).not.toContain('div')
    expect(tags).not.toContain('component')
  })

  it('finds unresolved component usages across files', () => {
    const files = [
      { filePath: '/tmp/A.vue', content: '<template><KnownCard /><UnknownWidget /></template>' },
      { filePath: '/tmp/B.vue', content: '<template><UButton /><known-card /></template>' },
    ]
    const registeredComponents = new Set<string>(['KnownCard', 'UButton'])
    const unresolved = findUnresolvedComponentUsages(files, registeredComponents)
    expect(unresolved).toEqual([{ filePath: '/tmp/A.vue', tag: 'UnknownWidget' }])
  })

  it('reports parse errors per file instead of throwing globally', () => {
    const result = analyzeComponentResolution(
      [{ filePath: '/tmp/Broken.vue', content: '<template><KnownCard></template>' }],
      new Set<string>(['KnownCard'])
    )
    expect(result.unresolved).toEqual([])
    expect(result.parseErrors).toHaveLength(1)
    expect(result.parseErrors[0]?.filePath).toBe('/tmp/Broken.vue')
  })

  it('treats locally imported script-setup components as resolved', () => {
    const content = `
<template>
  <Line />
  <ShipmentDocumentButtons />
</template>

<script setup lang="ts">
import { Line } from 'vue-chartjs'
import ShipmentDocumentButtons from '~/components/shipment/DocumentButtons.vue'
</script>
`
    const result = analyzeComponentResolution(
      [{ filePath: '/tmp/LocalImport.vue', content }],
      new Set<string>()
    )
    expect(result.parseErrors).toEqual([])
    expect(result.unresolved).toEqual([])
  })

  it('treats multiple named imports as resolved', () => {
    const content = `
<template>
  <Bar />
  <Line />
</template>

<script setup lang="ts">
import { Bar, Line } from 'vue-chartjs'
</script>
`
    const result = analyzeComponentResolution(
      [{ filePath: '/tmp/MultipleNamedImports.vue', content }],
      new Set<string>()
    )
    expect(result.parseErrors).toEqual([])
    expect(result.unresolved).toEqual([])
  })
})
