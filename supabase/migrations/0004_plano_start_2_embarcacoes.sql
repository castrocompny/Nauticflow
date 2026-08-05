-- Aumenta o limite de embarcações do plano Start de 1 para 2.
update public.plans set max_vessels = 2 where code = 'start';
