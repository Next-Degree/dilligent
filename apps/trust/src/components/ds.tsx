'use client';

/**
 * The design-system barrel also exports client-only modules (sidebar, carousel,
 * app shell, ...) that call createContext without a "use client" directive, so
 * evaluating it in a Server Component crashes. Re-exporting through a client
 * boundary keeps the barrel out of the server module graph.
 */
export {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  FieldError,
  FieldLabel,
  HStack,
  Heading,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  Textarea,
  VStack,
} from '@trycompai/design-system';
