<script lang="ts" setup>
import { cva } from "class-variance-authority";

defineProps<{
  size: "small" | "medium" | "large";
}>();

const className = cva("inline-block", {
  variants: {
    size: {
      small: "w-12",
      medium: "w-20",
      large: "w-32",
    },
  },
});
</script>

<template>
  <img :class="className({ size })" src="/public/logo.png" alt="BCC Media" />
</template>
